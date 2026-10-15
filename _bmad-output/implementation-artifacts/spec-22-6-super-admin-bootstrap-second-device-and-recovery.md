---
title: 'Super Admin bootstrap, second device and recovery'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '33e84524c784591b9bbbf6f27c9c2d53881ea05d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-5-super-admin-second-factor-enrollment-flag-off.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The `super_admin_aal2` flag exists but nothing can safely turn it on. With the flag on, an aal1 Super Admin is bounced to `/auth/login` in a loop (no second-factor prompt), and if a device is lost there is no way back in.

**Approach:** Add an operator-run script that flips the flag only when every Super Admin holds exactly two verified TOTP factors, an operator-run reset script that is the audited out-of-band recovery, an in-app second-factor prompt for aal1 sessions, and a runbook. No new product surface beyond the prompt.

## Boundaries & Constraints

**Always:** Scripts run as the database owner through the `pg` client pattern of `scripts/prod-apply.mjs` (connection from env, password from file, never printed) and default to dry-run; `--apply` and `--operator <name>` are required to write. Enable and reset each run in one transaction that also writes one `audit_log` row (`actor_id` null, `actor_display_name` `operator:<name>`, metadata holds factor ids, friendly names and counts, never a secret). Enable requires every `users.is_super_admin` account to have exactly two `verified` TOTP factors, prints each factor's friendly name and `created_at`, asks for typed confirmation, and is a no-op when already on. Reset deletes the target's factors and its `auth.sessions` and sets the flag **off** in the same transaction (otherwise the sole Super Admin cannot reach `/security` to re-enroll). The aal1 prompt only verifies an existing factor (`challengeAndVerify`); it never enrolls. Strings en and fr.

**Never:** No new migration, no change to flag-off behavior, no trigger on `auth.mfa_factors`, no session limits or step-up (22.7), no support-account creation (Epic 23), no CI execution of the scripts against production. Do not read or print TOTP secrets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enable, ready | all super admins have 2 verified factors, flag off, `--apply`, confirmed | flag on, one audit row | N/A |
| Enable, short | any super admin has 0, 1 or 3 verified, or an unverified one only | refuses, lists who, flag unchanged | exit 1 |
| Enable, repeat | flag already on | prints "already on", no row, no change | exit 0 |
| Enable, dry-run | no `--apply` | prints factors and verdict, rolls back | exit 0 |
| Reset | target email, `--apply`, confirmed | factors and sessions gone, flag off, one audit row | unknown email: exit 1 |
| Flag on, aal1 | valid password session | any `(admin)` route redirects to `/auth/mfa`; correct code reaches aal2 and `/gyms` | wrong code: error, stays |
| Flag on, aal1 | no session | `/auth/login` as before | N/A |
| Flag on, new factor | aal1 session calls enroll action | refused, provider not called | existing 22.5 gate, test added |

</frozen-after-approval>

## Code Map

- `scripts/prod-apply.mjs`, `scripts/prod-db.sh` -- connection, `pg` loading and password-file pattern to copy; script reads `auth.mfa_factors` (`factor_type`, `status`, `friendly_name`, `created_at`) directly.
- `scripts/enable-super-admin-aal2.mjs`, `scripts/reset-super-admin-factors.mjs` -- new; flag table `private.platform_flags` (0126), reader `private.super_admin_aal2_required()`.
- `scripts/job-runs-alert.test.sh`, `scripts/ci-local.sh:95`, `.github/workflows/ci.yml:101` -- pattern and wiring for a rolled-back local-DB script test.
- `apps/super-admin/lib/authz.ts` -- `requireSuperAdminAal2`/`denied`: add a `reason` to the denied result so the layout can tell `aal2_required` from other denials.
- `apps/super-admin/app/(admin)/layout.tsx:58` -- redirect `aal2_required` to `/auth/mfa`, everything else stays `/auth/login`.
- `apps/super-admin/app/auth/mfa/page.tsx` + client form -- new; model on `components/login-form.tsx`; lists verified TOTP factor, `mfa.challengeAndVerify`, then `router.push("/gyms")`; redirects to `/auth/login` without a session.
- `apps/super-admin/app/(admin)/security/actions.ts` + `actions.authz.test.ts` -- existing aal gate; add test only.
- `apps/super-admin/locales/{en,fr}.json` -- strings; `scripts/check-i18n-key-parity.mjs`.
- `docs/runbooks/super-admin-recovery.md` -- new; `docs/decisions.md` (newest first), `_bmad-output/planning-artifacts/epics.md` Epic 23 pre-flight (~line 398, 2927), `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/enable-super-admin-aal2.mjs` -- all-super-admins exactly-two check, typed confirm, one-transaction flag + audit, idempotent
- [x] `scripts/reset-super-admin-factors.mjs` -- one-transaction factor/session delete, flag off, audit
- [x] `scripts/super-admin-aal2.test.sh` (+ ci-local/ci.yml wiring) -- rolled-back local-DB scenarios for the I/O matrix script rows
- [x] `authz.ts`, `(admin)/layout.tsx`, `auth/mfa/*`, locales -- aal1 prompt and redirect; Vitest for reason mapping, wrong code, no-session
- [x] `actions.authz.test.ts` -- aal1 enroll refused before provider call with flag on
- [x] `docs/runbooks/super-admin-recovery.md` -- preconditions, lost one device, lost both, dual control note (PRD §8), post-reset re-bootstrap
- [x] `epics.md`, `docs/decisions.md`, `sprint-status.yaml` -- Epic 23 precondition (flag must be on before support creation), local dry-run date and result

**Acceptance Criteria:**
- Given the flag on and a verified aal1 session, when any admin route is requested, then the user lands on `/auth/mfa`, never a login loop.
- Given a rehearsal on local following the runbook (enable, lose a device, reset, re-enroll two factors, enable), then the Super Admin signs back in and the result is recorded in `docs/decisions.md`.
- Given `scripts/ci-local.sh`, when run, then GREEN.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

Recovery turns the flag off, not just the factors: with the flag on and zero factors an aal1 session is denied at the `(admin)` layout, so `/security` is unreachable and the account is locked out. The reset therefore reopens the first-factor window (22.1) on purpose; the runbook says to re-enroll both factors and re-run enable immediately. Staging and production runs are the product owner's; this story's evidence is the local rehearsal.

The 22.5 deferred item "concurrent factor removals can both pass the last-factor check" stays deferred: it needs two simultaneous aal2 requests from the sole operator and the reset script is its backstop.

## Verification

**Commands:**
- `bash scripts/super-admin-aal2.test.sh` -- expected: all ok
- `pnpm --filter super-admin test` -- expected: pass
- `node scripts/check-i18n-key-parity.mjs` -- expected: clean
- `bash scripts/ci-local.sh` -- expected: GREEN
