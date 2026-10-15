---
title: 'Super Admin second-factor enrollment (flag off)'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'a3090e7102c1522296ce5c8241c1ac433373f32a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-4-live-authorization-in-edge-functions-and-service-paths.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Super Admin account (which creates and assigns support people) is protected by a password and a phone code only. The claims hook and `private.is_super_admin()` ignore `aal`, and the app has no way to enroll an authenticator.

**Approach:** Add a platform flag `super_admin_aal2` (default off), a Super Admin security page whose enrollment, verification and removal run only in Server Actions that check the session `aal` first, and make `is_super_admin()` and the hook require `aal2` while the flag is on. Nothing changes for any session while the flag is off.

## Boundaries & Constraints

**Always:** Enrollment/verify/removal go through Server Actions on the session client after `authorizePlatformAction`; the browser never calls `mfa.enroll`. A second factor (any enroll while a verified factor exists) requires `aal2`; the first factor is allowed at `aal1` (22.1: provider already refuses the rest, the first-factor window is recorded in a test, no trigger on `auth.mfa_factors`). One `audit_log` row per enroll, verify, remove via `log_audit_event` on the session client (actor, action, timestamp; never a secret, QR URI or code). The flag is read through one definer helper; null/missing flag row = off. Hook reads `coalesce(event->'claims'->>'aal','aal1')` and emits `super_admin` only when flag off or `aal2` (fail closed). With the flag on, removing a factor that would leave zero verified is refused. Strings en and fr.

**Never:** Do not flip the flag on (22.6), no bootstrap script, runbook or recovery (22.6), no session limits or step-up (22.7), no support-role changes, no trigger on `auth.mfa_factors`, no client-side factor enrollment, no `__Host-` cookie change. Do not change flag-off behavior of any existing policy or RPC.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flag off | any Super Admin, aal1 | `is_super_admin()` true as before; hook emits claim | N/A |
| Flag on, aal1 | Super Admin token aal1 | `is_super_admin()` false; hook omits `super_admin` | denied everywhere |
| Flag on, aal2 | verified TOTP session | true | N/A |
| First factor | no factors, aal1 | enroll returns QR/secret; verified after correct code; audit rows written | wrong code: factor stays unverified, error shown |
| Second factor | one verified, aal1 | refused by server action before provider call | `permission_denied`-style error, no audit of success |
| Second factor | one verified, aal2 | enrolled, verified, audited | N/A |
| Remove factor | two verified, aal2 | removed and audited | aal1: refused |
| Remove last | flag on, one verified | refused | stable error, no change |
| Direct provider | aal1 session calls `POST /factors` with a verified factor present | 403 `insufficient_aal` | test asserts and records first-factor window |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0126_super_admin_aal2_flag.sql` + `scripts/rollback-0126-*.sql` -- new (0125 is highest): `private.platform_flags(flag text pk, enabled bool)` seeded `super_admin_aal2=false`, RLS on, no client grants; `private.super_admin_aal2_required()` definer; redefine `private.is_super_admin()` (0124:53, keep live `users.is_super_admin` check, add `aal2` condition when required, null-safe); redefine `public.custom_access_token_hook` (0065:77, keep exception handler and grants).
- `private.is_super_admin_live()` (0063:349) and `log_audit_event` inline claim check (0007:~190) -- check whether they must also honor the aal gate; keep flag-off identical.
- `apps/super-admin/lib/authz.ts` -- `authorizePlatformAction` pattern; add an `aal` check helper (`requireSuperAdminAal2()` per AD-38) returning ok when flag off.
- `apps/super-admin/app/(admin)/security/` -- new page + `actions.ts` (enroll, verify, remove, list); pattern from `(admin)/admins/actions.ts` (`{data,error}`, `getServerTranslation`, audit via session `rpc("log_audit_event", ...)` :202).
- `apps/super-admin/app/(admin)/layout.tsx` -- add nav link in `NAV_LINKS`; `locales/en.json`, `locales/fr.json` -- strings.
- `supabase/config.toml:342-344` -- set `[auth.mfa.totp] enroll_enabled/verify_enabled = true` (local; hosted per OQ-27).
- Tests: `supabase/tests/` pgTAP (jwt via `set_config('request.jwt.claims', ...)`, see `auth_hook_canary.test.sql`; `authorize_action.test.sql`), Vitest `*.authz.test.ts` style in `apps/super-admin`.

## Tasks & Acceptance

**Execution:**
- [x] `0126_super_admin_aal2_flag.sql` (+ rollback) -- flag table, helper, `is_super_admin`, hook -- AC flag/aal behavior
- [x] `apps/super-admin/lib/authz.ts` -- aal helper -- shared check for actions
- [x] `apps/super-admin/app/(admin)/security/{page.tsx,actions.ts}` -- enroll/verify/remove with audit and last-factor guard
- [x] `layout.tsx`, locales en/fr -- nav and strings -- parity check passes
- [x] `config.toml` -- enable TOTP locally
- [x] tests -- pgTAP both flag states for `is_super_admin` and hook (aal1/aal2, missing aal); direct-provider AAL1 attempt test; Vitest per action (aal1 refused before provider call, audit row, last-factor refusal, no secret in audit metadata)
- [x] `docs/decisions.md`, `sprint-status.yaml`

**Acceptance Criteria:**
- Given the flag off, when any existing Super Admin session acts, then behavior is unchanged and existing pgTAP/Vitest pass.
- Given the flag on and an aal1 session, when any Super Admin policy or RPC is used, then it is denied.
- Given enrollment, verification or removal, then exactly one audit row with no secret exists.
- Given `scripts/ci-local.sh`, when run, then GREEN.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Unverified factor cannot be removed at aal1 (orphans accumulate) | medium | patch | removeFactor demands aal2 for every removal; provider only requires aal2 for verified factors |
| Enroll leaves stale unverified factors | medium | patch | no cleanup before mfa.enroll |
| verify/remove ignore audit() result | medium | patch | success returned with no audit row, spec says one row per action |
| requireSuperAdminAal2 only mocked | medium | patch | inverting the aal check keeps all Vitest green |
| removeFactor fail-closed branches, audit-failure branches untested | medium | patch | no test returns rpc error or non-boolean |
| Direct-provider test skipped without env | low | defer | super-admin Vitest is not in ci-local stage_unit at all (pre-existing); test ran and passed locally after stack restart |
| Concurrent removals can both pass last-factor check | medium (unverified exploit) | defer | needs two simultaneous removals; flag stays off here; 22.6 script re-checks exactly two factors; real fix needs DB lock |
| No in-app aal1 -> aal2 challenge / redirect | medium | defer | belongs to 22.6 AC (flag-on redirect to prompt); flag stays off so no lockout in this story |
| Hook exception handler returns original event | maybe-false | defer | handler is the pre-existing 0065 behavior; GoTrue builds base claims without app_role; settle by checking claims on a hook error at flag on |
| Raw app_role readers not gated / log_audit_event inline claim | false | reject | pg_proc scan: only is_super_admin and the hook still read app_role with super_admin; log_audit_event no longer reads the claim |
| Wrong-code rate limit | low | reject | application lockout counter is 22.7 scope; provider rate-limits |
| verifyFactor on already-verified factor acts as step-up | low | reject | that is the normal login challenge; extra audit row is harmless |
| removeFactor unknown factorId | false | reject | provider returns error, no effect |
| UI: Enter submit, try/catch, confirm dialog, aria-live | low | reject | cosmetic, fix adds branches |
| Rollback script unverified / duplicates bodies | false | reject | implementer ran it in a rolled-back transaction |
| Flag read twice in removeFactor | low | reject | negligible |
| Spec task boxes / notes empty | low | patch | bookkeeping, done at step 5 |

## Design Notes

Flag lives in a table (not a GUC) so 22.6's script can set it in one audited transaction. The factor-removal last-factor guard lives in the server action (the provider API owns `auth.mfa_factors`); it is application-level, not a DB invariant, and 22.6's script re-checks exactly two verified factors before enabling.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` -- expected: all pass
- `pnpm --filter super-admin test` -- expected: pass
- `bash scripts/ci-local.sh` -- expected: GREEN
