---
title: '23-4 Create Support Account & Invite'
type: 'feature'
created: '2026-10-21'
baseline_commit: 'e41bf1802cf879ce7dfd6b02c16a070a75bbec31'
status: 'review'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No support person can exist yet: nothing creates a support account or writes `private.support_accounts`, so no support user is ever live (FR-175, FR-176, FR-193).

**Approach:** Migration 0138 adds the Super Admin-only create, invite-issue and activation functions (invite stored hashed, single-use, 24 h, bound to the email address, no temporary password) and an account-state read. The Super Admin app gets a "GymOS support" section (AAL2) to create and invite; the dashboard app gets one public invite route with two steps: set password, TOTP enrollment.

**Decisions (owner, 2026-10-21):**
- The invite link is emailed to the `@gymosapps.com` address; the link is the only secret and the mailbox is the binding. The mailbox existing is a precondition.
- The invitee route lives in the dashboard app (`apps/dashboard`), the surface support signs in to.
- The `@gymosapps.com` email is GymOS-controlled and trusted: verified at creation, so the account is assignable from creation. Assignable is not live: `activated_at` is set only when TOTP enrollment completes, and the live gate denies until then.
- Support has no phone number. There is no phone code and no phone on the account (null); the account is an email + password auth user. This deviates from FR-175/FR-176 and AD-38 wording (phone-bound, phone code), by owner decision; recorded in decisions.md.
- TOTP is enrolled as step 2 of the invite page (after setting the password), inside the invite-bound flow, never from a signed-in AAL1 session. Later sign-ins are email + password, then TOTP every time.
- Deferred to 23-6: which gym is active right after a multi-gym support sign-in (recommend forcing a pick).

## Boundaries & Constraints

**Always:**
- Creation is Super Admin at AAL2 only and refused while `super_admin_aal2` is off. The collision check (the email against `public.users`, `auth.users`, every Super Admin, `auth.identities`) is one function, run at creation and again at activation; the refusal message is the same whichever matched. 
- Email must be `@gymosapps.com`. The account starts inactive: no `support_accounts.activated_at`, no assignment, no membership. `activated_at` is written only by the activation function, only after a verified TOTP factor.
- Invite: random token, only its SHA-256 stored (as in `private.super_admin_recovery_code`), 24 h expiry, consumed once. Second use, expiry, and a wrong or malformed token all return one generic message. No temporary password exists; the person sets their own.
- TOTP enrollment for the invitee runs only through a server function that checks the invite and the account state (AD-38); it does not reuse the Super Admin `security/actions.ts` path.
- The email is verified at creation and is also the sign-in identifier (email + password, the existing dashboard login). The state read returns `assignable` (true from creation) separately from `activated`. The invite is consumed only at activation; until then the same link resumes at the step reached, with an attempts limit on token tries and on the TOTP code.
- One `audit_log` row per step (create, invite issued, activation, each refusal at activation); never the link, token, code or password. Actor is the real Super Admin.
- Every new function revokes from `public, anon`; guardrails clean; rollback script `scripts/rollback-0138-*.sql`.
- Gates reach consumers (retro 66): a pgTAP scan lists every function that writes `private.support_accounts`; only this story's functions (and later 23-10/23-11 by name) may.

**Never:** no assignment, allow-list, proxy actor or reset flow (23-5..23-11); no Super Admin as support; no reuse of `generateTempPassword`; do not apply to production.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Create | Super Admin AAL2, flag on, name and `@gymosapps.com` email | inactive account, assignable, not activated, one audit row | N/A |
| Collision | email matches a user, Super Admin or linked identity | refused, nothing written | one generic message |
| Flag off / AAL1 / non-admin | any create attempt | refused | permission error |
| Invite | account exists, verified channel | hashed single-use token, 24 h | N/A |
| Activate | valid link, password set, TOTP verified | `activated_at` set, audit row | N/A |
| Bad link | reused, expired or malformed token | nothing changes | one generic message |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql` -- `private.support_accounts` (sole target), `support_live` legs; `0128_super_admin_recovery_email.sql` -- hashed single-use code and cancel-token pattern to copy; `0126_super_admin_aal2_flag.sql` -- `private.super_admin_aal2_required()`, `is_super_admin()`. Next migration 0138.
- `apps/super-admin/lib/authz.ts` (`authorizePlatformAction`, `requireSuperAdminAal2`, `PlatformCapability`) + `private.capability_roles` -- add a capability for support management; `lib/authz-action.ts` `authorizeOrRedirect`.
- `apps/super-admin/app/(admin)/gyms/actions.ts` `createGym` (~L288) -- action shape; `lib/supabase/admin.ts` -- `auth.admin.*` only; `lib/super-admin-provisioning.mjs` `findUserByEmail`, `createAuthUserWithTempPassword` (do not reuse the temp password).
- `apps/super-admin/services/gyms.ts` `logGymLifecycleEvent` (~L894) -- audit via session-client `log_audit_event`; check the action-type list first.
- `apps/super-admin/app/(admin)/layout.tsx` `NAV_LINKS`, `locales/en.json` + `fr.json`, tests `*.authz.test.ts`, `server-actions.denied.test.ts`, `layout.authz.test.ts` -- register the new section and actions.
- `apps/super-admin/lib/mail.ts`, `lib/messaging/*`, `supabase/functions/send-sms-hook/` -- delivery options per the open questions; `lib/recovery.ts` `appBaseUrl()`, `generateCancelToken`.
- `supabase/tests/session_limits_step_up.test.sql`, `support_role_live_gate.test.sql` (`pg_temp.claims`), `super_admin_aal2_flag.test.sql` -- fixtures. Run `scripts/pgtap-run.sh`.
- Collision: compare the email case-insensitively with `auth.users.email`, `public.users`, Super Admins and `auth.identities`. A linked-identity check does not exist; write it. Phone-separation rules (0094) do not apply: the account has no phone.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0138_support_account_invite.sql` -- invite table (hash, expiry, consumed_at, attempts), collision check function, `create_support_account`, `issue_support_invite`, `activate_support_account`, account-state read, `private.support_accounts` writer, capability row, revokes
- [x] `scripts/rollback-0138-support-account-invite.sql` -- drop the new objects
- [x] `supabase/tests/support_account_invite.test.sql` -- matrix rows, flag off, AAL1, non-admin, each collision source with identical message, hash-only storage, expiry/reuse/malformed token, writer scan, ACLs
- [x] `apps/super-admin/lib/authz.ts` + `app/(admin)/support/{page.tsx,actions.ts,components}` + `layout.tsx` nav + `locales/en.json`, `fr.json` -- section, create and invite actions, state list; register in the authz and denied-action tests
- [x] `apps/super-admin/lib/mail.ts` use + invite mail template (EN/FR) -- link only, built from the configured origin
- [x] `apps/dashboard/app/support-invite/...` (sibling of the public `privacy` route; add it to the dashboard proxy's public paths) + service + tests -- two-step page with generic failure, TOTP enrollment through a server function bound to the invite
- [x] `packages/types/src/database.ts`, `docs/decisions.md`, `deferred-work.md` (23-6 active-gym pick), `sprint-status.yaml`

**Acceptance Criteria:**
- Given the account was created, when its state is read, then it is assignable and not activated, and the live gate still denies it.
- Given the flag is off or the session is AAL1, when creation is attempted, then it is refused and nothing is written.
- Given any step, when it happens, then one audit row exists and no row contains a link, token, code or password.
- Given an invite, when it is stored, then only its hash exists, and a second use, expiry or malformed token each return the same generic message.
- Given activation, when the Super Admin collision check re-runs and finds a new match, then activation is refused.
- Given `scripts/ci-local.sh`, when it runs, then every stage is green (read the per-stage lines).

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `scripts/pgtap-run.sh` on the new test file -- expected: all ok
- `node scripts/check-migration-guardrails.mjs` -- expected: clean
- `bash scripts/ci-local.sh` -- expected: GREEN on all five stages
