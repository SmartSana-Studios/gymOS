---
baseline_commit: 1364825781d6be56948d48f0e6c8b9120ded52bc
---

# Story 1.12: Super Admin Provisioning CLI Script

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As GymOS platform staff (an existing trusted operator with repo/env access),
I want a scripted, auditable way to create a new Super Admin account or promote an existing user to Super Admin,
so that granting the platform's highest-privilege role no longer requires hand-writing SQL directly against production.

**Context — not derived from `epics.md`:** this story does not exist in `_bmad-output/planning-artifacts/epics.md` (Epic 1's FR-004 states Super Admin is a platform-level role but the PRD never specified *how* one is provisioned — a genuine gap, not an oversight this story corrects). It was raised directly by the user (2026-08-05) while removing an unintentional self-serve `/auth/sign-up` flow from `apps/super-admin` and `apps/dashboard` (Supabase starter-kit boilerplate, deleted same session — see `apps/super-admin/components/login-form.tsx`'s now-removed sign-up link and the two deleted `sign-up`/`sign-up-success` route trees). That investigation confirmed **`public.users.is_super_admin` can currently only ever be set by hand-written SQL** — no seed script, admin API route, or in-app flow exists anywhere in this codebase. Story 1.5's own manual verification precedent proves this: its `superadmin@gymos.test` test account was created "via the GoTrue Admin API + a direct `is_super_admin=true` update," untracked in git, wiped by the next `supabase db reset` (`1-11-gym-owner-activation-temp-password-sms.md` Debug Log References). This story formalizes that ad-hoc pattern into a real, repeatable script — matching the project's established "size it as a proper story" discipline for anything touching production data mutation, per the PM persona's own principle: ship the smallest thing that closes the real gap, not a public-facing UI (rejected explicitly — see Dev Notes → Rejected Alternative).

## Acceptance Criteria

1. **Given** a service-role-authenticated CLI script (`provision-super-admin`) is run with `--email=<email>` for an address with no matching `auth.users` row, **when** it executes, **then** a new `auth.users` row is created via `admin.auth.admin.createUser({ email, password: <generated temp password>, email_confirm: true })` (no `phone` argument — `users.phone` is nullable, `supabase/migrations/0003_members_and_users.sql:9`, and Super Admin auth is email+password only per `architecture.md`'s "Dashboard/Coach/Super Admin auth: Supabase Auth email + password" line), the `handle_new_user` trigger's resulting `public.users` row then has `is_super_admin` set to `true` via a follow-up service-role `UPDATE`, and the generated temp password is printed once to stdout and nowhere else (never written to a file, log, or the audit record's `metadata`).
2. **Given** the script is run with `--email=<email>` for an address that already matches an existing `auth.users` row, **when** it executes, **then** no new `auth.users` row is created, no password is generated or printed, and the existing `public.users` row (matched by the auth user's `id`) has `is_super_admin` flipped to `true` via a service-role `UPDATE` — this promotion path succeeds cleanly despite `private.protect_self_managed_user_columns()` (`supabase/migrations/0015_users_self_service_language_preference.sql:32-46`) existing on the table, because that trigger's guard (`if auth.uid() = new.id`) only fires for a self-update under an authenticated session; a service-role client has no `auth.uid()` session at all, so the condition is never true and the column is written through unmodified.
3. **Given** either path (1) or (2) completes successfully, **when** the `is_super_admin` write commits, **then** the action is recorded via the canonical `log_audit_event()` function (`supabase/migrations/0007_audit_log.sql:151-219` — "the single recommended write path"), called with `p_action_type` distinguishing create-vs-promote (e.g. `'super_admin_provisioned'` / `'super_admin_promoted'`), `p_target_entity_id` = the affected user's `id`, `p_target_entity_type = 'users'`, and `p_system_actor_label = 'system:provision-super-admin-cli'` (the `p_system_actor_label` path, not a real session — matches the existing pg_cron system-caller convention documented in that function's own header comment). This can be done via a direct service-role `select log_audit_event(...)` RPC call from the script (service-role is granted `EXECUTE`, `0007_audit_log.sql:227`) — no new migration needed.
4. **Given** the script is run with a missing/malformed `--email` argument, a `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` env var missing, or any Admin API/database call failing, **when** it executes, **then** it prints a clear error to stderr and exits non-zero, and no partial state is left behind (an `auth.users` row created in path (1) whose subsequent `is_super_admin` update or audit-log write then fails must be rolled back by deleting the just-created auth user — same compensating-cleanup discipline as `createGym`'s `deleteAuthUserAndLog`, `apps/super-admin/app/(admin)/gyms/actions.ts:240-250`).
5. **Given** this script exists, **when** the story's `docs/decisions.md` entry is written, **then** it documents: why a CLI script was chosen over an in-app "invite Super Admin" UI flow (no new public attack surface; small, trusted operator team; explicitly rejected alternative, see Dev Notes), that this closes the same-session's removal of the unintended self-serve `/auth/sign-up` flow (cross-reference, don't re-derive), and the `protect_self_managed_user_columns` service-role-bypass reasoning from AC #2 (a real, non-obvious gotcha future stories touching that trigger should know).

## Tasks / Subtasks

- [ ] **Task 1: `apps/super-admin/scripts/provision-super-admin.mjs`** (AC: #1, #2, #4)
  - [ ] Plain Node ESM script (no new dependency — `@supabase/supabase-js` is already a direct dependency of `@gymos/super-admin`, `apps/super-admin/package.json:18`; placing the script inside this workspace package, not at the repo root, is deliberate — a root-level `scripts/*.mjs` (the `check-i18n-key-parity.mjs` precedent) cannot resolve a workspace-only dependency under pnpm's isolated `node_modules` layout, a real gotcha this project already hit and documented, `docs/decisions.md` 2026-07-10 Decision 8).
  - [ ] Parse `--email=<value>` via Node's built-in `node:util` `parseArgs` (zero new dependency, Node 22+ stable — this repo's `engines.node` is `>=22`). Validate with the same email-format rigor already used elsewhere in the codebase if a shared Zod schema exists in `@gymos/types`; otherwise a minimal inline regex check is acceptable for a CLI-only entry point.
  - [ ] Build the admin client the same way `apps/super-admin/lib/supabase/admin.ts` does (`createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })`) — do not import `admin.ts` directly (it may pull in Next.js-only module resolution); duplicate the ~10-line client construction locally, matching this codebase's existing precedent of small, purpose-scoped duplication over premature cross-boundary sharing (`1-11...md` Task 2's identical reasoning for not importing across the Next.js/Deno boundary).
  - [ ] Reuse (do not reinvent) the fixed-alphabet temp-password generator pattern established in `apps/super-admin/app/(admin)/gyms/actions.ts`'s `generateTempPassword` (Story 1.11 Task 3 — excludes `0`/`O`/`1`/`l`/`I`, length ≥ 8) for the create-new-user path's generated password. If it is not already exported/importable, extract it to a small shared local helper rather than copy-pasting the implementation twice in the same app.
  - [ ] Existing-user lookup: use `admin.auth.admin.listUsers()` filtered client-side by email, or `admin.auth.admin.getUserByEmail` if available on the installed `@supabase/supabase-js` version (verify against the installed version — check `latest` resolves to; do not assume an API surface without confirming).
  - [ ] Implement AC #4's rollback: wrap the create-path's `is_super_admin` UPDATE and audit-log RPC call such that any failure after a successful `createUser` triggers `admin.auth.admin.deleteUser(id)` before exiting non-zero, mirroring `deleteAuthUserAndLog`'s pattern (`apps/super-admin/app/(admin)/gyms/actions.ts:240-250`) but this script's own local equivalent (no `mapAndLog`/toast dependency — this is a CLI, not a Server Action).
- [ ] **Task 2: Wire the script into `apps/super-admin/package.json`** (AC: #1, #2)
  - [ ] Add `"provision-super-admin": "node --env-file=.env.local scripts/provision-super-admin.mjs"` to `apps/super-admin/package.json`'s `scripts` block, using Node's built-in `--env-file` flag (Node 20.6+, stable well within this repo's `>=22` floor) to load `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` from the same `.env.local` Story 1.11 already established for this app's local Twilio credentials — no new `dotenv` dependency (matches this project's demonstrated preference for minimal added dependencies, `docs/decisions.md` 2026-07-10 Decision 5).
  - [ ] Document invocation in a short comment atop the script and in the Task 5 `docs/decisions.md` entry: `pnpm --filter @gymos/super-admin provision-super-admin -- --email=someone@example.com`.
- [ ] **Task 3: Audit log write** (AC: #3)
  - [ ] Call `log_audit_event` via the service-role client's RPC interface (`admin.rpc('log_audit_event', { p_action_type: ..., p_target_entity_id: ..., p_target_entity_type: 'users', p_system_actor_label: 'system:provision-super-admin-cli' })`), matching the function's documented system-caller path (`supabase/migrations/0007_audit_log.sql:199-205`). Confirm the RPC call actually inserts a row (verify manually or via a quick pgTAP assertion) before considering Task 3 complete — do not assume the call signature is correct without confirming.
- [ ] **Task 4: pgTAP regression coverage** (AC: #2)
  - [ ] Extend `supabase/tests/users_self_service_rls.test.sql` (or a new adjacent test file) with an assertion that a `service_role`-context `UPDATE users SET is_super_admin = true WHERE id = ...` (simulated via `reset role`/`set role service_role`, matching this suite's existing session-simulation conventions) succeeds and is **not** reverted by `protect_self_managed_user_columns` — this is the one regression this story could most easily ship silently (a future edit to that trigger tightening its guard beyond the `auth.uid() = new.id` check could break this script without any application-level test catching it). Write the assertion to fail first against the trigger as it exists today would be wrong — confirm it currently passes, then keep it as a permanent regression guard.
- [ ] **Task 5: `docs/decisions.md` entry** (AC: #5)
  - [ ] One dated entry (today's date) covering: the CLI-over-UI decision and why (cross-reference this session's sign-up-flow removal rather than re-deriving); the service-role-bypasses-`protect_self_managed_user_columns` mechanism (AC #2) as a reusable gotcha note for future stories; and that this formalizes Story 1.5/1.11's previously undocumented manual `is_super_admin` update pattern into a real, repeatable, audit-logged path for the first time.
- [ ] **Task 6: Manual verification** (AC: all)
  - [ ] Run against real local Supabase (WSL2 Docker, per this project's standing environment — see `[[project_supabase_wsl]]`): (a) create-path with a fresh email, confirm `auth.users`+`public.users` rows exist, `is_super_admin = true`, printed password logs in successfully via the real login form; (b) promote-path against an existing non-super-admin user, confirm no new auth user is created and the flag flips; (c) confirm an `audit_log` row exists for each with the correct `action_type`/`target_entity_id`/`actor_display_name = 'system:provision-super-admin-cli'`; (d) missing `--email` and missing env var both exit non-zero with no rows created (re-check `select count(*) from auth.users` before/after each negative case). Clean up all test data afterward via the GoTrue Admin API + direct `psql`, matching every prior story's established cleanup discipline (1.5, 1.8, 1.11).

## Dev Notes

### Rejected Alternative — considered and explicitly not chosen

An in-app "invite Super Admin" flow (a new Super Admin inviting another, gated behind the existing `(admin)` layout's `app_role === 'super_admin'` guard, mirroring the member-invitation deep-link pattern, `2-5-member-invitation-via-deep-link.md`) was discussed with the user and rejected in favor of this CLI script. Reasoning discussed: the Super Admin team is small and tightly held (unlike gym-member invitation, which happens routinely at scale); a CLI adds zero new public/authenticated-app attack surface, while an in-app flow would add a new authorization-sensitive code path (who can invite whom, token expiry, etc.) for a capability likely exercised only a handful of times total. Revisit if the platform-staff team grows enough that routine, self-serve Super Admin invitation becomes worth the added surface — not a decision this story needs to re-litigate, just record.

### Technical Requirements & Architecture Compliance

- **Service-role client only, never in a browser-reachable path.** This script runs entirely server-side/CLI — same discipline as `apps/super-admin/lib/supabase/admin.ts`'s own header comment ("MUST NEVER be imported from a Client Component"). There is no Client Component risk here since it's a standalone script, but the same service-role key handling care (env-file only, never hardcoded, never printed) applies.
- **RLS is the sole tenancy/role enforcement layer everywhere else in this codebase** — this script is a deliberate, narrow, documented exception (same category as `createGym`'s `admin.auth.admin.createUser` calls) because creating/promoting a Super Admin is fundamentally an Admin-API-only operation with no RLS-policy equivalent, exactly like `apps/super-admin/lib/supabase/admin.ts`'s own justification.
- **`log_audit_event` is the single canonical audit write path** (`0007_audit_log.sql:110-120`) — do not hand-roll a direct `INSERT INTO audit_log` even though `service_role` technically has grant-level INSERT access; using the function keeps actor-derivation/system-label conventions consistent with every other system-caller (pg_cron) audit record.
- **No automated E2E testing in V1** (established project standard, reconfirmed every prior story touching auth) — Task 6's manual verification pass is required, not optional.

### Previous Story Intelligence

- **Story 1.5** (`1-5-super-admin-create-onboard-a-gym.md`) — established `createUser`/compensating-cleanup (`deleteAuthUserAndLog`) patterns this story's Task 1/4 directly reuse. Its own manual-verification precedent is the exact ad-hoc `is_super_admin=true` update this story formalizes.
- **Story 1.11** (`1-11-gym-owner-activation-temp-password-sms.md`, most recently completed in Epic 1) — established the fixed-alphabet temp-password generator (`generateTempPassword`, reuse per Task 1), the `.env.local`-per-app credential convention (reuse per Task 2), and is the most recent story to touch `protect_self_managed_user_columns`'s allow-list — confirms that trigger is actively maintained and this story's Task 4 regression test is a genuinely live concern, not a hypothetical one.
- **Story 1.10** (`1-10-bilingual-en-fr-platform-foundation.md`) — the pnpm workspace-isolation gotcha (Decision 8) directly informs Task 1's "why this script lives in `apps/super-admin/`, not the repo-root `scripts/`" reasoning.

### Git Intelligence Summary

- HEAD is `1364825` (`feat(auth): background photo and logo on auth pages`). Uncommitted working-tree changes at story-creation time: deletion of `apps/{super-admin,dashboard}/app/auth/{sign-up,sign-up-success}/` and `components/sign-up-form.tsx`, plus a `login-form.tsx` edit removing the sign-up link — this session's prerequisite cleanup, not part of this story's own diff. Confirm these are committed (or intentionally left staged) before starting Task 1 so this story's diff is cleanly attributable.

### Testing Standards

- pgTAP, `supabase/tests/*.test.sql`, run via `supabase test db` — same CI job as every prior story (Task 4).
- Manual end-to-end verification required (Task 6) — pgTAP alone cannot exercise the Admin API `createUser` call or the script's CLI argument handling.

### Project Structure Notes

- New file: `apps/super-admin/scripts/provision-super-admin.mjs` — first script of its kind in this app; no existing `scripts/` directory under `apps/super-admin/` today (verify at Task 1 start; create if absent).
- No `packages/types` changes needed — this story adds no new shared schema/type, only a local CLI script and an audit-log call using the existing `log_audit_event` signature.

### References

- [Source: supabase/migrations/0003_members_and_users.sql:7-14, 55-70] — `users` table shape (`is_super_admin boolean not null default false`, `phone` nullable), `handle_new_user` trigger
- [Source: supabase/migrations/0009_auth_hook_gym_claims.sql] — `custom_access_token_hook()` reads `is_super_admin` to stamp the `app_role` JWT claim consumed by every RLS policy and the `(admin)` layout guard
- [Source: supabase/migrations/0015_users_self_service_language_preference.sql:32-46] — `protect_self_managed_user_columns` trigger; AC #2's service-role-bypass reasoning is anchored directly on this function's `auth.uid() = new.id` guard
- [Source: supabase/migrations/0007_audit_log.sql:110-227] — `log_audit_event()`, the canonical write path, system-caller convention (`p_system_actor_label`), and the `service_role` EXECUTE grant this script relies on
- [Source: apps/super-admin/lib/supabase/admin.ts] — service-role client construction pattern this script duplicates locally (Task 1)
- [Source: apps/super-admin/app/(admin)/gyms/actions.ts:142-160, 240-250] — `createUser` call shape and `deleteAuthUserAndLog` compensating-cleanup pattern this script's Task 1/4 mirror
- [Source: _bmad-output/implementation-artifacts/1-11-gym-owner-activation-temp-password-sms.md] — `generateTempPassword` (reuse), `.env.local`-per-app convention, Debug Log's `superadmin@gymos.test` manual-provisioning precedent this story formalizes
- [Source: docs/decisions.md#2026-07-10 — Bilingual Platform Foundation, Decision 8] — pnpm workspace-isolation gotcha informing Task 1's file placement
- [Source: docs/decisions.md#2026-07-10 — Bilingual Platform Foundation, Decision 6] — precedent for what counts as "confirmed dead scaffolding" vs. live code, relevant context from the same session's sign-up-flow removal referenced in this story's Context section
- [Source: architecture.md#Authentication & Security] — "Dashboard/Coach/Super Admin auth: Supabase Auth email + password... no alternative needed"
- [[project_supabase_wsl]] — local Supabase/Docker must run from WSL for Task 6's manual verification

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
