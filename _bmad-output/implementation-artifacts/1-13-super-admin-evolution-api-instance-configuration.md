---
baseline_commit: 013ead6a7ebed558bd55b16a4e02af9694123a2e
---

# Story 1.13: Super Admin Evolution API Instance Configuration + Logout Wiring Fix

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As GymOS platform staff (Super Admin),
I want to view and update the active Evolution API instance ID from the Super Admin dashboard,
so that when a connected WhatsApp number disconnects, I can point the platform at a working instance immediately, without a code deployment.

**Context — not derived from `epics.md`:** like Story 1.12, this story does not exist in `_bmad-output/planning-artifacts/epics.md`. It was raised via `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-08.md` (Correct Course workflow, approved 2026-08-08), sections 4.3 and 4.3b — adopting a self-hosted Evolution API WhatsApp gateway. This story covers **only** the Super Admin instance-config surface plus a small bundled bug fix (missing Logout wiring); it does **not** touch OTP delivery or member invitations — those are separate, dependent stories (Epic 2's Evolution API sandbox spike + provider chain, and the Story 2.5 revision) that read this table's value once it exists. `architecture.md` and `prd.md` have **not yet been edited** with the proposal's planned changes (confirmed: `messaging_provider_config` does not appear in `architecture.md` as of this story's creation) — treat the proposal document itself as the authoritative source for this story, not `architecture.md`.

## Acceptance Criteria

1. **Given** the Super Admin Messaging settings page, **when** I view it, **then** I see the currently configured Evolution API instance ID (or a clear "not configured" state if none has been set yet).
2. **Given** a new instance ID, **when** I enter it and save, **then** `messaging_provider_config` is updated, the change takes effect for the next OTP/invite send with no redeploy, and the change is audit-logged (actor, old value, new value, timestamp) via `log_audit_event`.
3. **Given** an empty or malformed (blank/whitespace-only) instance ID, **when** I attempt to save, **then** the save is rejected with an inline validation error and the previous value remains active — no RPC call is made, no audit entry is written.
4. **Given** the Super Admin nav bar (`apps/super-admin/app/(admin)/layout.tsx`), **when** it renders, **then** a Logout control (reusing the existing `LogoutButton` component, `apps/super-admin/components/logout-button.tsx`) appears alongside Metrics/Tiers/Payment Providers/Language toggle.
5. **Given** Super Admin clicks Logout, **when** the sign-out completes, **then** the session ends and they're redirected to `/auth/login` (unchanged `LogoutButton` behavior — no new logic needed, just wiring it into the real layout).

## Tasks / Subtasks

- [x] **Task 1: Migration `0050_messaging_provider_config.sql`** (AC #1, #2, #3)
  - [x] `create table messaging_provider_config (id uuid primary key default gen_random_uuid(), instance_id text, updated_by uuid references public.users(id), updated_at timestamptz not null default now());` — `instance_id` is **nullable** (represents "not yet configured," AC #1's fallback state — there is no real placeholder value to seed since Evolution API is a self-hosted service outside this migration's control).
  - [x] Singleton enforcement follows `payment_providers`' proven pattern (`0029_payment_provider_registry.sql`), not a new mechanism: seed exactly **one** row at migration time (`insert into messaging_provider_config (instance_id) values (null);`) and never expose an INSERT policy to any role — the sanctioned RPC (below) only ever `UPDATE`s, so the row count is structurally fixed at 1 forever. No partial-unique-index trick needed (that technique exists in `payment_providers` because multiple *existing* rows compete for one `is_active = true`; here there is only ever one row, period).
  - [x] `alter table messaging_provider_config enable row level security;` then the 0002 baseline-grant discipline: `grant select, insert, update, delete on messaging_provider_config to authenticated, service_role;` (grants are necessary but not sufficient — RLS is the real gate; see `0002_gyms_and_tiers.sql`'s own comment on why this pairing is required).
  - [x] One SELECT policy only, mirroring `super_admin_read_payment_providers` exactly: `create policy "super_admin_read_messaging_config" on messaging_provider_config for select using (private.is_super_admin());`. **No INSERT/UPDATE/DELETE policy for any role** — deny-all default, same "single blessed write path" posture as `audit_log`/`payment_providers`.
  - [x] `update_messaging_instance(p_instance_id text) returns void` — `security definer`, `set search_path = public`, mirrors `activate_payment_provider()`'s shape exactly (`0029_payment_provider_registry.sql:52-91`):
    - `if not private.is_super_admin() then raise exception 'permission denied'; end if;`
    - `if p_instance_id is null or btrim(p_instance_id) = '' then raise exception 'update_messaging_instance: instance_id must not be empty'; end if;` — defense-in-depth behind the Zod schema (Task 2), same belt-and-suspenders relationship `activate_payment_provider()` has with its own Server Action's validation.
    - Lock the singleton row (`select instance_id into v_previous from messaging_provider_config for update;`) before reading it, for the identical race-safety reason documented in `activate_payment_provider()`'s comment (concurrent callers must not both log a stale `previous_instance_id`).
    - `update messaging_provider_config set instance_id = p_instance_id, updated_by = auth.uid(), updated_at = now();`
    - `perform log_audit_event(p_action_type => 'messaging_instance_updated', p_target_entity_id => (select id::text from messaging_provider_config), p_target_entity_type => 'messaging_provider_config', p_metadata => jsonb_build_object('previous_instance_id', v_previous, 'new_instance_id', p_instance_id));` — satisfies AC #2's "actor, old value, new value, timestamp" (actor + timestamp are `log_audit_event`'s own `auth.uid()`/`created_at` columns, not extra params — same as every other audit call in this codebase).
    - No no-op short-circuit needed here (unlike `activate_payment_provider`'s idempotent reactivate case) — saving the same value twice is still a legitimate, intentional Super Admin action worth its own audit trail entry; do not add one.
    - `revoke execute on function update_messaging_instance from public; grant execute on function update_messaging_instance to authenticated;`
  - [x] Do **not** add a service-role read RPC (e.g. an `active_messaging_instance()` analog to `active_payment_provider()`) in this story — the Epic 2 spike/chain story and the Story 2.5 revision each own their own read path against this table via their existing service-role clients (service-role bypasses RLS entirely, confirmed pattern from Story 1.12's Dev Notes). Adding one now would be speculative, unrequested surface.

- [x] **Task 2: Zod schema + service layer + Server Action** (AC #2, #3)
  - [x] `packages/types/src/schemas/messagingProviderConfig.ts`: `export const updateMessagingInstanceSchema = z.object({ instanceId: z.string().trim().min(1, "Instance ID is required") });` — mirrors `activatePaymentProviderSchema`'s shape/comment style (`packages/types/src/schemas/paymentProvider.ts`) exactly. Export the inferred type too (`UpdateMessagingInstanceInput`).
  - [x] Add `export * from "./schemas/messagingProviderConfig";` to `packages/types/src/index.ts` (same line pattern as the existing `paymentProvider` export).
  - [x] `apps/super-admin/services/messaging-provider-config.ts` — two functions, both using the `{ data, error }` / `mapAndLog` contract from `apps/super-admin/services/gyms.ts` (reuse `mapAndLog`, do not reimplement it):
    - `getMessagingInstance(): Promise<{ data: { instanceId: string | null; updatedAt: string | null } | null; error: AppError | null }>` — `supabase.from("messaging_provider_config").select("instance_id, updated_at").single()`.
    - `updateMessagingInstance(instanceId: string): Promise<{ error: AppError | null }>` — thin RPC wrapper over `update_messaging_instance`, same shape as `activatePaymentProvider()` in `apps/super-admin/services/payment-providers.ts`.
  - [x] `apps/super-admin/app/(admin)/messaging/actions.ts` — `"use server"`, one exported `updateMessagingInstance(input: unknown)` Server Action: parse with `updateMessagingInstanceSchema.safeParse`, return `{ error: { code: "validation_error", message } }` on failure (first Zod issue, matching `setActivePaymentProvider`'s exact error shape), otherwise call the service function and forward its result. Copy `setActivePaymentProvider`'s structure (`apps/super-admin/app/(admin)/payment-providers/actions.ts`) almost verbatim.

- [x] **Task 3: Messaging settings page UI** (AC #1, #2, #3)
  - [x] `apps/super-admin/app/(admin)/messaging/page.tsx` — Server Component + explicit `<Suspense>` boundary, identical pattern to `payment-providers/page.tsx` (this app's `cacheComponents: true` requires it, per that file's own comment). Calls `getMessagingInstance()`, renders `MessagingSettingsPageClient` with the initial value, or a load-error message via `t("common.loadError")` on failure.
  - [x] `apps/super-admin/app/(admin)/messaging/loading.tsx` — same skeleton-pulse shape as `payment-providers/loading.tsx`.
  - [x] `apps/super-admin/app/(admin)/messaging/components/MessagingSettingsPageClient.tsx` — single-field inline form (not a modal — this is one platform-wide value, not a list of rows like Tiers/Payment Providers). State: `instanceId` (text input, pre-filled from `initialInstanceId ?? ""`), `fieldError`, `formError`, `submitting`. On submit: `e.preventDefault()`, trim, reject empty client-side first (`t("messaging.errors.instanceIdRequired")`) before even constructing the Zod input (same "validate on submit only" UX-DR11 precedent `TierModal.tsx` follows), then call the Server Action, `router.refresh()` on success (re-pulls the Server Component's fresh `updated_at`), map `error.code === "audit_log_failed"` to a non-blocking success-with-warning path **only if** that error code is realistically reachable here — check `mapSupabaseError` (`apps/super-admin/services/gyms.ts`'s import) for whether it already maps a `log_audit_event` RPC failure to that code; if so, reuse it (matches `TierModal.tsx`'s `audit_log_failed` handling), otherwise treat any RPC error as a blocking `formError`.
  - [x] Show last-updated context if available (`updated_at`) as a small muted-text line under the input — optional polish, not a blocker if time-constrained, since AC #1 only requires the instance ID itself.

- [x] **Task 4: Nav link + i18n** (AC #1)
  - [x] Add `<Link href="/messaging" className="text-sm text-muted-foreground hover:text-foreground">{t("nav.messaging")}</Link>` to `apps/super-admin/app/(admin)/layout.tsx`'s nav, alongside the existing Metrics/Tiers/Payment Providers links (same flat-link pattern, not a dropdown — this app "has exactly one role and two [now three] flat destinations besides the brand link," per that file's own comment; update or leave that comment as accurate as you judge best).
  - [x] Add `"messaging"` namespace to both `apps/super-admin/locales/en.json` and `apps/super-admin/locales/fr.json` (title, current-instance label, input label/placeholder, save button + saving state, `errors.instanceIdRequired`) plus `nav.messaging` in both files' `nav` block — follow the exact key-naming and en/fr-parity conventions already established by the `paymentProviders` namespace in both files (this project has a CI job checking i18n key parity — `check-i18n-key-parity.mjs`, referenced in Story 1.12's Dev Notes — do not add a key to one locale file without the other).

- [x] **Task 5: Wire Super Admin Logout** (AC #4, #5)
  - [x] In `apps/super-admin/app/(admin)/layout.tsx`, import `LogoutButton` from `@/components/logout-button` and render it in the nav bar (after `LanguageToggle`, or wherever reads best — it's a single existing component, no new props/logic per AC #5's explicit "no new logic needed, just wiring it into the real layout").
  - [x] Do **not** modify `logout-button.tsx` itself. Its "Logout" label is hardcoded English (not run through `t()`) — a pre-existing gap the proposal's bundled fix does not ask you to close (its AC only covers wiring, not translation). Leave it as-is; do not silently fix or silently ignore — note it in this story's Dev Agent Record if you notice it during implementation.

- [x] **Task 6: pgTAP regression coverage** (AC #2, #3)
  - [x] New file `supabase/tests/messaging_provider_config_rls.test.sql`, following `payment_providers_rls.test.sql`'s exact session-simulation conventions (super_admin vs. non-super-admin fixture users, `set_config('request.jwt.claims', ...)`). Assert:
    - Non-super-admin session sees 0 rows via direct SELECT (deny-all, not an exception).
    - Super-admin session can SELECT the seeded singleton row.
    - Direct `UPDATE messaging_provider_config ...` under a `super_admin`-claimed session does **not** throw (see Dev Agent Record — `UPDATE`'s `USING` clause means a missing policy silently matches 0 rows, unlike `INSERT`) — asserted via `lives_ok` + a value-unchanged check instead of the originally-planned `throws_like`. `update_messaging_instance()` is still confirmed as the only sanctioned write path.
    - `update_messaging_instance()` called by a non-super-admin session throws `%permission denied%`.
    - `update_messaging_instance(null)` and `update_messaging_instance('   ')` both throw `%must not be empty%` under a super-admin session, and leave `instance_id` unchanged.
    - `update_messaging_instance('evo-instance-1')` under a super-admin session succeeds, updates `instance_id`/`updated_by`/`updated_at`, and writes an `audit_log` row with `action_type = 'messaging_instance_updated'` and `metadata ->> 'new_instance_id' = 'evo-instance-1'` (and `previous_instance_id` = whatever the prior value was, `null` on first save).
  - [x] Update the pgTAP `plan(N)` count for this new file to match its actual assertion count (do not guess — count them after writing). Final count: `plan(11)`.

- [x] **Task 7: `docs/decisions.md` entry** (informational, not a hard AC — but this codebase's established convention per every prior spike/decision story)
  - [x] Recorded a 2026-08-08 entry: Task 6's `pgTAP` assertion revealed `UPDATE` (unlike `INSERT`) does not raise under RLS deny-all with no policy — genuinely decision-worthy since `payment_providers_rls.test.sql`'s precedent only ever tested this via `INSERT`, so any future "deny-all + one write RPC" table's pgTAP coverage should know this distinction upfront.

- [x] **Task 8: Manual verification** (AC: all)
  - [x] Run against real local Supabase (WSL2 Docker — see `[[project_supabase_wsl]]`): (a) load `/messaging` as super_admin, confirm "not configured" state on a fresh DB; (b) save a valid instance ID, confirm it persists across a page reload and an `audit_log` row exists with correct old/new values; (c) attempt to save an empty/whitespace value, confirm inline error and no audit entry written — **all three verified via a real Supabase Auth → PostgREST → RPC network call (not just pgTAP); (a)/(b)/(c)'s page-rendering confirmed in-browser in the follow-up session below**.
  - [x] (d) confirm Logout appears in the nav and signing out redirects to `/auth/login` — **verified in-browser in a follow-up session**, resumed inside a newly-created devcontainer (not the original WSL2 environment). Dev server started cleanly (`pnpm --filter super-admin dev`), user logged in with a freshly-provisioned super-admin test account, confirmed both **Messaging** and **Logout** render as separate nav links, confirmed the Messaging page renders correctly (instance-ID field, "not configured" state on the freshly-reset DB), and confirmed clicking Logout redirects to `/auth/login`. The prior session's blocker (Claude-in-Chrome outage + browser login hang) did not reproduce here — consistent with it having been an artifact of the old WSL2 environment (`[[project_wsl_idle_shutdown_fix]]`), not the application code.
  - [x] (e) confirm a non-super-admin (e.g. a gym-owner dashboard session, or an unauthenticated request) cannot reach `/messaging`'s data — this should already be covered by the existing `(admin)/layout.tsx` guard (Story 1.8), not new logic this story adds, but verify it wasn't accidentally weakened. **Unauthenticated case independently re-verified**: `curl -D- http://localhost:3000/messaging` (no session cookie) returns `307` → `location: /auth/login`, identical to the `/gyms` admin route used as a control — the layout guard is intact and unweakened. The authenticated-non-super-admin case relies on the same unchanged code path plus pgTAP's own RLS deny-all coverage (Task 6, confirms a non-super-admin session gets 0 rows from `messaging_provider_config` directly) — no separate non-super-admin account exists in this app to click-test directly, and none is warranted given the guard is provably unchanged.

## Dev Notes

### Technical Requirements & Architecture Compliance

- **This is a config-table CRUD story, not an integration story.** No Evolution API network call, no `WhatsAppMessageProvider`/`OtpDeliveryProvider` code is written here — this story only stores a string the *other* stories (Epic 2 spike, Story 2.5 revision) will read. Do not scope-creep into implementing the provider interface or calling the real Evolution API.
- **`log_audit_event` is the single canonical audit write path** (`0007_audit_log.sql:151-227`) — do not hand-roll a direct `INSERT INTO audit_log`, matching the identical rule Story 1.12's Dev Notes already established.
- **RLS deny-all + one SECURITY DEFINER write function is this codebase's established pattern for tiny, platform-wide Super-Admin-managed tables** — `payment_providers` (`0029_payment_provider_registry.sql`) is the direct precedent this story mirrors almost line-for-line. Do not invent a different shape (e.g., allowing a direct `UPDATE` policy for `super_admin` — that would be a real deviation from every prior platform-config table in this codebase and is not requested).
- **`architecture.md`/`prd.md` are stale relative to this story** (see Context section above) — implement against the sprint-change-proposal's Section 4.2/4.3/4.3b text, not against `architecture.md`'s current (pre-edit) content for this specific feature. Everything else in `architecture.md` (service boundaries, `{ data, error }` pattern, RLS conventions) still applies normally.

### Previous Story Intelligence

- **Story 1.12** (`1-12-super-admin-provisioning-cli.md`, most recently completed in Epic 1) — confirms the working pattern for a story not sourced from `epics.md` (source is a proposal/user request instead); confirms `log_audit_event`'s system-vs-real-actor split is well-trodden; confirms `[[project_supabase_wsl]]` is required for this story's Task 8 manual verification.
- **Story 4.1** (`payment_providers` registry, `0029_payment_provider_registry.sql` + `apps/super-admin/app/(admin)/payment-providers/*`) is this story's single closest structural precedent — same "tiny platform-wide Super-Admin-CRUD table, RLS deny-all + one write RPC" shape the sprint-change-proposal explicitly calls for ("RLS mirroring `tiers`" in the proposal's prose, but the *actual* closest code-level analog once you compare table shapes is `payment_providers`, not `tiers` — `tiers` allows direct multi-row CRUD via several RPCs, `payment_providers` is the single-active-value-via-one-RPC shape this story actually needs). Reuse its file structure, naming, and RPC/audit conventions directly rather than `tiers`'.

### Git Intelligence Summary

- HEAD is `013ead6` (`fix(types): stop rejecting valid Postgres UUIDs that fail RFC 4122's stricter check`). The working tree has **unrelated uncommitted changes** at story-creation time, including `supabase/functions/send-sms-hook/index.ts` (likely in-progress work toward the Epic 2 Evolution API spike/chain story) and `docs/decisions.md`. Do not assume a clean tree — check `git status` before starting, and do not attribute pre-existing uncommitted changes to this story's own diff when committing.
- Migration numbering: highest existing migration is `0049_audit_log_dashboard_read_policy.sql` — this story's migration is `0050_messaging_provider_config.sql`. Confirm no `0050` was added concurrently before creating the file.

### Testing Standards

- pgTAP, `supabase/tests/*.test.sql`, run via `supabase test db` — same CI job as every prior story (Task 6).
- No automated E2E testing in V1 (established project standard) — Task 8's manual verification is required, not optional.
- This project checks i18n key parity via a CI script (`check-i18n-key-parity.mjs`) — Task 4's en/fr additions must stay in lockstep.

### Project Structure Notes

- New files: `supabase/migrations/0050_messaging_provider_config.sql`, `apps/super-admin/app/(admin)/messaging/{page.tsx,loading.tsx,actions.ts,components/MessagingSettingsPageClient.tsx}`, `apps/super-admin/services/messaging-provider-config.ts`, `packages/types/src/schemas/messagingProviderConfig.ts`, `supabase/tests/messaging_provider_config_rls.test.sql`.
- Modified files: `apps/super-admin/app/(admin)/layout.tsx` (nav link + Logout wiring), `apps/super-admin/locales/{en,fr}.json`, `packages/types/src/index.ts`.
- No changes to `apps/super-admin/components/logout-button.tsx` (Task 5) or to any Deno Edge Function — this story is entirely within `apps/super-admin` + `supabase/migrations` + `packages/types`.

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-08.md#4.2, #4.3, #4.3b] — the authoritative spec for this story (table shape, ACs, rationale); `architecture.md`/`prd.md` do not yet reflect it.
- [Source: supabase/migrations/0029_payment_provider_registry.sql] — direct structural precedent: table shape, RLS deny-all + one SECURITY DEFINER write RPC, audit-log metadata shape (`previous_*`/`new_*` keys), grant/revoke pattern.
- [Source: apps/super-admin/services/payment-providers.ts, apps/super-admin/app/(admin)/payment-providers/{actions.ts,page.tsx,loading.tsx,components/PaymentProvidersPageClient.tsx}] — direct file-structure precedent for Tasks 2–3.
- [Source: apps/super-admin/app/(admin)/tiers/components/TierModal.tsx] — "validate on submit only" (UX-DR11) client-side validation pattern reused for Task 3's inline error handling.
- [Source: packages/types/src/schemas/paymentProvider.ts, packages/types/src/index.ts:11] — Zod schema + export pattern for Task 2.
- [Source: supabase/migrations/0007_audit_log.sql:151-227] — `log_audit_event()` signature and system/real-actor conventions.
- [Source: supabase/migrations/0010_super_admin_gym_provisioning.sql:18] — `private.is_super_admin()` helper definition, used by every policy/RPC in this story.
- [Source: apps/super-admin/app/(admin)/layout.tsx] — nav structure (Task 4) and the security-boundary comment explaining why this layout exists at all.
- [Source: apps/super-admin/components/logout-button.tsx] — the component Task 5 wires in unmodified.
- [Source: supabase/tests/payment_providers_rls.test.sql] — pgTAP session-simulation conventions reused verbatim for Task 6.
- [Source: _bmad-output/implementation-artifacts/1-12-super-admin-provisioning-cli.md] — prior non-epics-sourced story precedent; `[[project_supabase_wsl]]` manual-verification requirement.
- [[project_supabase_wsl]] — local Supabase/Docker must run from WSL for Task 8's manual verification.

## Change Log

- 2026-08-08: Tasks 1-7 implemented and verified (pgTAP: 861/861 passing, i18n key parity: passing). Task 8 (manual verification) partially complete — DB-level checks (AC #1-#3) confirmed over a real Supabase Auth → PostgREST → RPC network call; browser-level UI checks (AC #1 rendering, #4, #5, #5) blocked by a Claude-in-Chrome tool outage and a still-unexplained login hang in the user's own browser. Paused mid-Task-8 at the user's request so they can restart their machine and retry.
- 2026-08-11: Resumed in a newly-created devcontainer (replacing the original WSL2 environment). Task 8(d)/(e) completed: dev server started, user logged in via a freshly-provisioned super-admin account, confirmed Messaging + Logout nav links, Messaging page render, and Logout → `/auth/login` redirect, all in-browser. The prior blocker did not reproduce in this environment. Unauthenticated `/messaging` access re-confirmed via `curl` (307 → `/auth/login`). Full regression suite re-run: first pass (against the long-running, not-yet-reset local DB) showed 2 unrelated failures (`audit_log_manager_owner_read`, `check_out_manual_auto_timeout`) caused by accumulated DB state, not this story's code — confirmed by running `supabase db reset` and re-running, which came back 861/861 passing clean. i18n key parity re-confirmed passing. All tasks complete; Status → review.
- 2026-08-11 (code review): Resumed a prior code-review session's unresolved findings (1 Decision, 5 Patches — the diff hadn't changed since that session, so a fresh re-review was skipped in favor of verifying and acting on the existing list). Verification against the actual source caught two problems in the prior findings before acting on them: the "race condition" patch's premise was backwards (`setSubmitting(true)` already ran before the `await`, not after), and the "non-idempotent migration" patch's own suggested fix (`ON CONFLICT DO NOTHING`) would have been a no-op given `id`'s random default — applied a genuinely idempotent `WHERE NOT EXISTS` guard instead, verified manually. All 6 items resolved: the Decision (added explicit `mapSupabaseError` mapping for the empty-instance-id RPC raise) and all 5 Patches (audit-log-failure rollback guard, `REVIEW_TEST_PHONE` moved to an env var, error logging added to the client catch block, double-submit guard added, idempotent seed insert). pgTAP suite re-run clean twice (861/861 after each schema change) and i18n key parity re-confirmed passing. Also discovered and fixed: the prior review session had overwritten `deferred-work.md` (429 lines of prior-story deferred-work history) instead of appending to it — restored from git history and re-applied this story's 4 deferred items as a proper append. Also cleaned up 4 stray scratch files (`EDGE_CASE_ANALYSIS.md`, `edge_case_analysis.md`, `actual_diff.patch`, `diff_to_review.patch`) left in the repo root by that session. Status → done.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the `bmad-dev-story` workflow.

### Debug Log References

- pgTAP full suite: `supabase test db` → `Files=44, Tests=861, ... Result: PASS` (includes the new 11-assertion `messaging_provider_config_rls.test.sql`).
- i18n key parity: `node scripts/check-i18n-key-parity.mjs` → `apps/super-admin/locales: 159 keys, en/fr in parity`.
- DB-level manual verification (AC #1-#3), run as a real signed-in super_admin session over the network (not pgTAP, not the browser UI): `supabase.auth.signInWithPassword` → initial `instance_id: null` confirmed → blank-value RPC call rejected with `instance_id must not be empty`, value unchanged, no audit row → valid RPC call succeeds, `instance_id`/`updated_by`/`updated_at` all updated → matching `audit_log` row confirmed (`action_type: messaging_instance_updated`, correct actor, `previous_instance_id: null` → `new_instance_id`). Script was temporary, run from `apps/super-admin/` via a local Node interop path, and deleted after use — not part of the File List below.
- Task 8(d)/(e) (browser-level Logout/nav check, non-super-admin denial re-verification): **not completed this session**. Two independent blockers, logged for whoever resumes:
  1. The Claude-in-Chrome browser tool's safety-check backend refused every navigation attempt (both `http://127.0.0.1:3000` and, as a control, `https://example.com`) across ~10 retries with backoff — a tool-side outage, not specific to this app or localhost.
  2. The user's own browser, logging in manually at `http://127.0.0.1:3000/auth/login` with the provisioned super-admin account, reported the page "hangs and reloads, no error shown" and "no change" to the URL bar (ruling out a pre-hydration native `<form>` GET submission as the cause). The underlying Supabase Auth endpoint itself was confirmed healthy and fast via a direct `curl` password-grant request (0.13s, valid JWT with `app_role: super_admin` present) — so the backend/credentials are not the problem; the cause is somewhere in the browser/client-side session, not yet root-caused. Restarting the dev server cleanly (fresh process, no stray file-watcher churn) did not change the symptom. `[[project_wsl_idle_shutdown_fix]]` and `[[project_mobile_device_testing_env]]` document this machine's history of WSL2/networking quirks and are the most likely starting point when resuming — the user is restarting their computer to retry.
- Local super-admin test account provisioned for this story's manual verification: `dev-story-1-13@example.com` (via `pnpm --filter @gymos/super-admin provision-super-admin -- --email=dev-story-1-13@example.com --yes`, run through WSL's Node-interop path since WSL itself has no native Node install — only Windows-side `node`/`pnpm` are usable directly; Supabase/Docker still must run in WSL per `[[project_supabase_wsl]]`). Temp password was printed to the session only, not committed anywhere.
- **Follow-up session (2026-08-11), new devcontainer environment:** `.devcontainer/` (Ubuntu 24.04, native Node 22 + pnpm 10.27, Docker-outside-of-Docker) replaced the WSL2 setup — Node/pnpm run natively, no interop path needed. `pnpm --filter super-admin dev` started cleanly on `http://localhost:3000`. No browser automation tool was available in this session either (no Claude-in-Chrome / Playwright-class tool), so Task 8(d)'s login/logout click-through was performed by the user directly in their own browser while the assistant provisioned test accounts and verified server-side behavior.
  - Provisioned `dev-story-1-13-verify@example.com` for the first click-through (pre-DB-reset): user confirmed login → `/gyms`, Messaging + Logout nav links both present, Messaging page rendered, Logout → `/auth/login` redirect all worked.
  - `curl -D- http://localhost:3000/messaging` (no cookie) → `307` to `/auth/login`, same as the `/gyms` control route — confirms the unauthenticated-denial half of AC #5(e) without needing a browser.
  - Ran `pnpm exec supabase test db`: 859/861 passed, 2 failures unrelated to this story (`audit_log_manager_owner_read` test 6: "have 5, want 4" audit_log rows; `check_out_manual_auto_timeout` test 21: "have 9, want 1" job_runs rows) — both exact-count assertions against a local DB that had been running 16+ hours accumulating real state, not this story's `messaging_provider_config_rls.test.sql` (which passed both times). Ran `pnpm exec supabase db reset` to confirm, then re-ran the suite: **861/861 passing clean**, confirming the two failures were stale-state artifacts, not regressions.
  - Re-provisioned `dev-story-1-13-verify2@example.com` after the reset (the first account was wiped) for a second click-through against the clean DB: user confirmed the same login → nav (Messaging + Logout) → Messaging page render → Logout → `/auth/login` sequence.
  - Re-ran `node scripts/check-i18n-key-parity.mjs`: passing (`apps/super-admin/locales: 159 keys, en/fr in parity`).
  - Neither verify account nor its temp password was committed anywhere; both exist only in the local dev Supabase instance.

### Completion Notes List

- Migration mirrors `payment_providers`' RLS-deny-all + single `SECURITY DEFINER` write-RPC pattern almost line-for-line, as directed. One deviation from the literal Task 6 spec, recorded in `docs/decisions.md` (2026-08-08 entry): a direct `UPDATE` against a table with no `UPDATE` policy does not raise (unlike `INSERT`, which always does) — it silently affects 0 rows. `payment_providers_rls.test.sql`'s own precedent only ever exercised this via `INSERT`, so this was untested precedent, not a verified pattern; caught empirically when the originally-planned `throws_like('%row-level security%')` assertion failed pgTAP with "no exception thrown." Fixed to `lives_ok` + a value-unchanged check, which is the actually-correct proof for `UPDATE`.
- `logout-button.tsx`'s "Logout" label is hardcoded English (not run through `t()`) — a pre-existing gap noted per Task 5's own instruction, left untouched (out of this story's scope, wiring only).
- Task 3's `audit_log_failed` question resolved by inspection: `update_messaging_instance()` is atomic (single RPC does the update + audit write together, same as `activate_payment_provider()`), so unlike `TierModal.tsx` (which makes two separate calls — a mutation, then a separate audit-log call — and so has a real "saved but audit failed" case) there is no reachable `audit_log_failed` path here. `MessagingSettingsPageClient.tsx` follows `PaymentProvidersPageClient.tsx`'s simpler pattern instead (any RPC error is a blocking `formError`), not `TierModal.tsx`'s.
- Task 8 is now fully complete — see Debug Log References above. All five ACs verified: #1-#3 at the data layer (prior session) and in-browser page rendering (this session); #4/#5 (Logout nav placement + redirect) confirmed in-browser this session in a newly-created devcontainer, which did not reproduce the prior session's WSL2-specific login hang. Full pgTAP regression (861/861, post-`db reset`) and i18n key parity both re-confirmed clean. Status → `review`.

### File List

- `supabase/migrations/0050_messaging_provider_config.sql` (new)
- `supabase/tests/messaging_provider_config_rls.test.sql` (new)
- `packages/types/src/schemas/messagingProviderConfig.ts` (new)
- `packages/types/src/index.ts` (modified — added `messagingProviderConfig` export)
- `apps/super-admin/services/messaging-provider-config.ts` (new)
- `apps/super-admin/app/(admin)/messaging/actions.ts` (new)
- `apps/super-admin/app/(admin)/messaging/page.tsx` (new)
- `apps/super-admin/app/(admin)/messaging/loading.tsx` (new)
- `apps/super-admin/app/(admin)/messaging/components/MessagingSettingsPageClient.tsx` (new)
- `apps/super-admin/app/(admin)/layout.tsx` (modified — `/messaging` nav link, `LogoutButton` wiring, nav comment updated)
- `apps/super-admin/locales/en.json` (modified — `nav.messaging`, `messaging.*` namespace)
- `apps/super-admin/locales/fr.json` (modified — `nav.messaging`, `messaging.*` namespace)
- `docs/decisions.md` (modified — 2026-08-08 entry on RLS `UPDATE`-vs-`INSERT` deny-all behavior)

---

### Review Findings

#### Decision Needed

- [x] [Review][Decision] RPC validation error code mapping — **Resolved 2026-08-11: add explicit mapping.** Verified the two `update_messaging_instance()` raises against `packages/types/src/errors.ts`: neither `'permission denied'` nor `'update_messaging_instance: instance_id must not be empty'` was matched by `mapSupabaseError()`, so both fell through to the generic `unknown` code. Fixed by adding a branch for the empty-instance-id raise (`validation_error` code, new `errors.messagingInstanceRequired` copy key in both locales) — the sibling `permission denied` raise stays deliberately unmapped, matching this file's own established precedent for other RPCs' permission-denied raises (unreachable through this story's role-gated call path).

#### Patches (Must Fix — all applied 2026-08-11)

- [x] [Review][Patch] Audit-log failure causes RPC transaction rollback — `supabase/migrations/0050_messaging_provider_config.sql`, `update_messaging_instance()` RPC — verified: `perform log_audit_event()` was unwrapped, so an audit-log failure would roll back the already-applied `instance_id` update via plpgsql's default whole-transaction rollback. **Note:** this exact pattern is copied verbatim from `activate_payment_provider()` (`0029_payment_provider_registry.sql`), which has the identical gap and was left as-is — applying a fix here only, without a matching fix there, is inconsistent, but proceeding per explicit instruction to keep the original triage. **Fix applied:** wrapped the `perform log_audit_event(...)` call in a nested `BEGIN...EXCEPTION WHEN OTHERS` block that logs a `RAISE WARNING` and swallows the error instead of re-raising, so the instance update survives an audit-log failure. pgTAP suite re-run clean (861/861) after the change.

- [x] [Review][Patch] Hardcoded test phone in production source — `supabase/functions/send-sms-hook/index.ts` — verified real (the finding's cited line number was computed from the review's temp diff-patch file, not the actual source; correct location is line 122). **Fix applied:** replaced the hardcoded `const REVIEW_TEST_PHONE = "+237699000001"` literal with `Deno.env.get("REVIEW_TEST_PHONE")`, added the value to `supabase/.env` (gitignored, local-dev only) with a comment cross-referencing `config.toml`'s matching `[auth.sms.test_otp]` entry. **Not done:** setting the equivalent secret in the real deployed Edge Function environment (Vercel/Supabase project config) — that's outside this review's reach; flagging for whoever next touches deployment config.

- [x] [Review][Patch] Uncaught async errors with no logging — `apps/super-admin/app/(admin)/messaging/components/MessagingSettingsPageClient.tsx` — verified: the `catch` block didn't even bind an error parameter (`catch {`), let alone log one. **Fix applied:** changed to `catch (err)` and added `console.error("MessagingSettingsPageClient.handleSubmit error:", err);` before setting `formError`.

- [x] [Review][Patch] Race condition in concurrent form submits — `apps/super-admin/app/(admin)/messaging/components/MessagingSettingsPageClient.tsx`, `handleSubmit()` — **verification note:** the finding's premise was checked against the actual code and found inaccurate — `setSubmitting(true)` already runs *before* the `await`, not after it, contradicting the finding's stated reasoning. Proceeding per explicit instruction to keep the original triage and apply the finding's suggested fix regardless. **Fix applied:** added an early-return guard (`if (submitting) return;`) at the top of `handleSubmit`, the second half of the finding's suggested fix, hardening against a double-submit beating the disabled-button re-render.

- [x] [Review][Patch] Non-idempotent migration — `supabase/migrations/0050_messaging_provider_config.sql` — **verification note:** checked against `payment_providers`' own seed insert (`0029_payment_provider_registry.sql:129`), which has the identical no-guard shape and was never flagged — this is this codebase's established one-time-seed pattern, and Supabase's migration runner tracks applied migrations exactly-once (the "deployment retry re-runs the insert" scenario isn't realistically reachable through normal tooling). Proceeding per explicit instruction to keep the original triage. **Also found:** the finding's own literal suggested fix (`ON CONFLICT DO NOTHING`) would have been a no-op — `id` defaults to a fresh `gen_random_uuid()` on every insert and `instance_id` carries no unique constraint, so nothing would ever conflict and a re-run would silently insert a second row, breaking the singleton invariant. **Fix applied:** guarded the insert with `WHERE NOT EXISTS (SELECT 1 FROM messaging_provider_config)` instead, which is actually idempotent — verified manually (`db reset`, then re-ran the insert directly against the live DB: row count stayed at 1). pgTAP suite re-run clean (861/861) after the change.

#### Deferred (Pre-existing or Out-of-Scope)

- [x] [Review][Defer] Zod .trim() vs PostgreSQL btrim() whitespace mismatch — Client-side `z.string().trim()` and server-side `btrim()` handle different Unicode whitespace sets. A string with exotic whitespace (U+200B zero-width space) might pass client validation but fail server. **Why deferred:** Extremely rare in practice (requires user paste of exotic characters); validation still succeeds for all typical input. Fix in follow-up if user reports.

- [x] [Review][Defer] No visual confirmation that router.refresh() completed — After successful save, `router.refresh()` re-fetches Server Component with no visual feedback. User is uncertain if action persisted. **Why deferred:** UX polish, non-blocking; can be improved with toast/checkmark in future. Acceptance criteria fully met.

- [x] [Review][Defer] Test phone bypass masks provider configuration issues — SMS hook test phone returns 200 immediately, bypassing real provider check. Deployments could proceed with misconfigured provider. **Why deferred:** Out-of-scope for Story 1.13 (SMS hook changes belong to Epic 2 work). Flagged for deployment process awareness (pre-deployment verification should test with real phone number or provider health check).

- [x] [Review][Defer] auth.uid() not validated before UPDATE — RPC `update_messaging_instance()` calls `auth.uid()` without null check. If session expires mid-call (theoretical edge case), `updated_by = NULL` is written, violating audit trail. **Why deferred:** Pre-existing pattern across all RPCs in codebase (Story 1.12 confirms same pattern). Codebase-wide concern, not Story 1.13 specific. Address in broader audit/RLS review if needed.
