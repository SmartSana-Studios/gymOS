---
title: 'Super Admin recovery email'
type: 'feature'
created: '2026-10-16'
status: 'review'
baseline_commit: '4b82f29ee3e0025ddda8bea8170bfc784d9a7d3a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-6-super-admin-bootstrap-second-device-and-recovery.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-7-session-limits-and-step-up.md'
  - '{project-root}/docs/runbooks/super-admin-recovery.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Super Admin who loses the device holding their authenticator cannot sign in. Today the only way back is an operator running `scripts/reset-super-admin-factors.mjs` with database access, and Epic 22's rule of exactly two TOTP factors only helps if the second one is on a separate device, which nothing enforces.

**Approach:** A Super Admin registers a verified **recovery email**, a different mailbox from the login email. From `/auth/mfa`, after the password step, they can ask for a one-time code sent to it. A valid code removes their authenticators and sessions (the same effect as the operator reset) so they can sign in with the password and enrol a new authenticator. The code never grants aal2 and never replaces TOTP at sign-in. Recovery-only: TOTP stays the only sign-in second factor.

## Boundaries & Constraints

**Always:**
- The recovery email must differ from the login email (case-insensitive, compared after trim) and be verified by a code sent to it before it is saved. Only an aal2 session can set, change or remove it, and changing or removing it needs a step-up (22.7).
- The recovery code is 6 digits, single use, expires in 10 minutes, stored hashed (never plaintext), allows 3 wrong attempts, and a new request invalidates the previous one. At most 3 requests per hour and 5 per day per account, enforced in the database.
- A valid code runs in one transaction: delete the account's `auth.mfa_factors` and `auth.sessions`, clear its lock, support state and step-up grants, consume the code, write one `audit_log` row. It does not turn the `super_admin_aal2` flag off.
- Taking effect is delayed: the factor reset applies `recovery_delay_minutes` (default 30, in `private.session_limits_config`) after the code is accepted. During the delay the login email and the recovery email both get a "recovery requested" notice, and the account can cancel it from either email link or an operator can cancel it. The delay can be set to 0 for local testing only.
- Every request, wrong code, acceptance, cancellation and application writes an audit row (`actor_id` null when unauthenticated, otherwise the user) with no code and no full recovery address in metadata (masked, for example `a***@example.com`).
- Wrong recovery codes count toward the 22.7 lockout; a locked account cannot request or use recovery.
- The response to a request is identical whether or not the account exists, has a recovery email, or is a Super Admin (no account enumeration). Strings en and fr.

**Never:**
- No recovery that skips the password, no code that grants aal2 or a session, no change to the sign-in prompt's use of TOTP, no email or SMS as a sign-in second factor.
- Do not store or log a code, a hash input or the full recovery address. Do not send the code to the login email.
- No change to flag-off behaviour. No new dependency on a paid service without the spike decision below.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register | aal2 Super Admin enters a different address, then the emailed code | recovery email saved as verified, one audit row | wrong code: error, not saved; same as login email: refused |
| Register, aal1 | aal1 session or no session | refused before any email is sent | `permission_denied` |
| Request | password-only session, account has a verified recovery email | code emailed to it, masked address shown, delay notice sent to both addresses | rate limited: generic "try again later" |
| Request, none set | no recovery email on the account | same generic response, nothing sent, audit row | N/A |
| Request, other user | unknown email or non-Super-Admin | same generic response, nothing sent | N/A |
| Valid code | within 10 minutes, attempts left | reset scheduled for now + delay, notices sent | N/A |
| Delay elapsed | no cancel | factors and sessions removed, user signs in with password and enrols again at `/security` | N/A |
| Cancel | link from either email, or operator | scheduled reset dropped, audit row | expired link: error |
| Wrong code | 3 times | code invalidated, counts toward lockout | locked: refused |
| Expired or reused code | older than 10 minutes, or already consumed | refused | generic invalid code |

</frozen-after-approval>

## Open Decisions (approved 2026-10-16; only the provider pick below is open)

1. **Mail sender.** Spike run 2026-10-16, findings in "Spike result" below. Needs the product owner's pick of provider and sending domain.
2. **Delay vs. approval. RESOLVED 2026-10-16: 30-minute delay** (`recovery_delay_minutes`, default 30), no second-admin approval. Revisit if a second Super Admin becomes routine.
3. **Relationship to "exactly two TOTP factors". RESOLVED 2026-10-16:** `enable-super-admin-aal2.mjs` accepts, per Super Admin, either exactly two verified factors, or exactly one verified factor plus a verified recovery email. Record in `docs/decisions.md`.

## Spike result (2026-10-16)

- **Production today** (read-only call to the Supabase management API, no secrets printed): no custom SMTP (host, user, sender and password all unset), so Auth uses Supabase's built-in mailer. `rate_limit_email_sent` is 2 per hour for the whole project and `smtp_max_frequency` 60 s. As I understand Supabase's documented limits, the built-in mailer is meant for testing and delivers only to addresses of the project's team members; not verified here. Either way, 2 emails an hour cannot carry recovery codes plus two notices per request.
- **Repo:** no mailer code anywhere (`[auth.email.smtp]` is commented out in `supabase/config.toml`; dashboard password reset uses the Auth mailer). The Super Admin app has no way to send mail.
- **Why not Auth's mailer:** it only mails an auth user's own address with its fixed templates. The recovery address is not an auth user, and a notice to two addresses is not something Auth sends.
- **Recommendation:** send from a Server Action through one small `lib/mail.ts` using SMTP (nodemailer). One code path: locally it targets Inbucket (set `smtp_port = 54325` under `[inbucket]` in `config.toml`, mail visible at http://127.0.0.1:54324), in production it targets a transactional provider's SMTP endpoint through env vars (`MAIL_SMTP_HOST/PORT/USER/PASS/FROM`), server-only, never `NEXT_PUBLIC_`. Optionally also point Supabase Auth at the same provider to lift its 2 per hour cap (separate, not required by this story).
- **Needs from the product owner:** a provider account (any with SMTP and good deliverability), a sending domain (for example `gymosapps.com`) with SPF and DKIM records added at the DNS host, and a from-address such as `security@gymosapps.com`. Provider names are suggestions, not checked: Resend, Postmark, Amazon SES.
- **Not changed:** no code, config or production setting was touched by the spike.

## Build notes (2026-10-16, found while building; outside the frozen block)

- **Enrolment after a reset.** The frozen text says a recovery does not turn the flag off, but with the flag on a zero-factor Super Admin cannot reach `/security` (the admin layout wants aal2) and 22.6's reset script solved that by turning the whole flag off. Migration 0128 instead adds `private.recovery_enrol_allowed(user)`: true for `recovery_enrol_window_minutes` (1440) after a reset applies while the account has no verified factor. The app work (a page outside the aal2 layout that enrols the first factor only) is still to do.
- **Delay minimum.** `session_limits_config.value` must be > 0, so the local-testing delay is 1 minute, not 0.
- **Lock wins.** A pending reset on an account that is locked (or whose recovery email was removed) is cancelled, not applied.
- **Done so far:** migration 0128 + rollback + 55 pgTAP assertions; `lib/mail.ts` + 8 Vitest tests; local Inbucket SMTP port in `supabase/config.toml` (needs one `supabase stop && start`).
- **Also done:** Server Actions (`/security` aal2, sign-in prompt aal1, first-authenticator page, cancel route), `EnrollDialog` shared modal, email templates en/fr, enable/reset script changes (+ shell tests), runbook, decisions entry, checklist section F.
- **Still to do (not code):** Resend sender domain (SPF/DKIM) and production env vars (`MAIL_*`, `SUPER_ADMIN_APP_URL`), run checklist section F by hand, code review (`bmad-code-review`). `ci-local.sh` green on 2026-10-16 (static, deno, pgtap, unit, e2e); dirty run, clean re-run follows the status commit.

## Code Map

- `supabase/migrations/0128_*.sql` (+ `scripts/rollback-0128-*.sql`) -- new: `private.super_admin_recovery` (user_id, recovery_email, verified_at), `private.super_admin_recovery_code` (user_id, code_hash, expires_at, attempts, consumed_at, requested_at), `private.super_admin_recovery_pending` (apply_at, cancelled_at), config key `recovery_delay_minutes`. `SECURITY DEFINER` functions with locked search_path, no `authenticated` EXECUTE on the privileged ones (see the 22.7 `super_admin_locked` revoke and the anon-EXECUTE trap in `project_epic18_post_deploy_state`).
- `apps/super-admin/app/(admin)/security/` -- recovery email section (register, change, remove) in modals, step-up on change and remove.
- `apps/super-admin/app/auth/mfa/` -- "I can't use my authenticator" flow: request, enter code, pending/cancelled states.
- `apps/super-admin/lib/` -- mail sender chosen in the spike; code generation uses a CSPRNG.
- `scripts/reset-super-admin-factors.mjs` -- show a pending recovery and allow cancelling it (`--cancel-recovery`).
- A scheduled job (pg_cron, as other jobs do) applies due resets and removes expired codes.
- `locales/{en,fr}.json`, `docs/runbooks/super-admin-recovery.md`, `docs/decisions.md`, `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] Spike: choose the mail sender and record the production send path and rate limits (result below; provider pick pending)
- [x] Migration 0128 with tables, functions, grants, rollback and pgTAP (rate limits, attempts, expiry, single use, same-address refusal, no enumeration, delay, cancel, lock interaction)
- [x] Server Actions for register, request, verify, cancel; each audited and rate limited
- [x] `/security` recovery email section and `/auth/mfa` recovery flow, modals, en/fr
- [x] Enable script accepts one verified factor + verified recovery email (or exactly two factors), still refusing zero, unverified-only or three factors; its dry-run lists which rule each admin meets. Reset script cancel option, runbook update, decisions entry
- [x] Vitest for actions and UI states; browser checklist items added to the Epic 22 checklist (section F, items 34-42)

**Acceptance Criteria:**
- Given an aal2 Super Admin with a different recovery address, when they enter the emailed code, then it is saved as verified; the same address as the login email is refused.
- Given a password-only session, when the recovery code is requested and entered, then nothing changes immediately, both mailboxes get a notice, and after the delay the account has no factors and no sessions.
- Given a cancel link used within the delay, then the account is unchanged and the cancellation is audited.
- Given an unknown email, a non-Super-Admin or an account with no recovery email, then the response is identical to a real request and nothing is sent.
- Given a wrong code three times, then the code is dead and the attempts count toward the lockout.
- Given `scripts/ci-local.sh`, when run, then GREEN.

## Risks

- Recovery email plus password is enough to take over the account after the delay. Mitigation: delay, notices to both mailboxes, cancel path, audit, rate limits, step-up for changes. The 30-minute delay was chosen over second-admin approval (decided 2026-10-16).
- The mail sender is unknown; the story is blocked on the spike.
- Epic 22's retro items 1-4 (gating Server Actions, concurrent-removal, hook-error deferrals) should land first, because this story adds new Server Actions that must use the same gate.
