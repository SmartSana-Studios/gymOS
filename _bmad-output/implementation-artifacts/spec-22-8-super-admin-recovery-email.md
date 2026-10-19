---
title: 'Super Admin recovery email'
type: 'feature'
created: '2026-10-16'
status: 'done'
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

- **Enrolment after a reset.** The frozen text says a recovery does not turn the flag off, but with the flag on a zero-factor Super Admin cannot reach `/security` (the admin layout wants aal2) and 22.6's reset script solved that by turning the whole flag off. Migration 0128 instead adds `private.recovery_enrol_allowed(user)`: true for `recovery_enrol_window_minutes` (60 after review; was 1440) after a reset applies while the account has no verified factor. The app work (a page outside the aal2 layout that enrols the first factor only) is still to do.
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
- Given a wrong code three times, then the code is dead; wrong recovery codes do not count toward the account lockout (review decision D1).
- Given a pending recovery, when the owner completes an aal2 sign-in, then it is cancelled and both mailboxes are told (D2).
- Given `scripts/ci-local.sh`, when run, then GREEN.

## Risks

- Recovery email plus password is enough to take over the account after the delay. Mitigation: delay, notices to both mailboxes, cancel path, audit, rate limits, step-up for changes. The 30-minute delay was chosen over second-admin approval (decided 2026-10-16).
- The mail sender is unknown; the story is blocked on the spike.
- Epic 22's retro items 1-4 (gating Server Actions, concurrent-removal, hook-error deferrals) should land first, because this story adds new Server Actions that must use the same gate.

## Review (2026-10-16, bmad-code-review, full mode, 4 layers, all reported)

### Review Findings

- [x] [Review][Decision] A password-only attacker can lock the Super Admin out — wrong recovery codes call `stepup_record_failure`, so 5 wrong codes lock the account until an operator releases it (spec says wrong recovery codes count toward the lockout). Options: keep as specified (and say so in the runbook), or let wrong recovery codes only kill the code (3 attempts, 3 requests/hour) without feeding the account lockout. [medium] [0128 `recovery_code_consume`] (blind-hunter + edge-case-hunter)
  - RESOLVED (D1 b): wrong recovery codes only kill the code; `stepup_record_failure` is no longer called; pgTAP asserts no lockout row.
- [x] [Review][Decision] A pending recovery is not cancelled when the real owner signs in at aal2 during the delay — their working authenticators are still wiped at `apply_at`, and an attacker's scheduled reset also still applies if the owner ignores the notice and just logs in. Options: auto-cancel pending recoveries on a successful aal2 sign-in (and notify), or keep cancel-link-only. [medium] [0128 `recovery_apply_due`] (edge-case-hunter)
  - RESOLVED (D2 a): `recovery_cancel_for_user` + `cancelPendingRecoveryOnSignIn` after the aal2 code is accepted (aal2 re-checked server side); audit `by: owner_signin`; both mailboxes told.
- [x] [Review][Decision] More notices — today only scheduling sends mail. Candidates: tell the login mailbox when the recovery email is set, changed or removed (a hijacked aal2 session can plant an attacker mailbox with no alert); tell both mailboxes when the reset applies and when it is cancelled. Needs your call on which, since each adds mail templates (en/fr) and send paths. [medium] [`recovery-actions.ts`, `recovery_apply_due`] (blind-hunter)
  - RESOLVED (D3 b, partly): login mailbox is told on set/change/remove; both mailboxes on cancel (link or owner sign-in). NOT done: a mail when the reset applies, because pg_cron cannot send mail and the app has no scheduler/outbox; the scheduling notice with its cancel link is the warning. Revisit if a worker is added.
- [x] [Review][Decision] First-authenticator window after a reset is 24 h for any password-only session — whoever holds the password can race the owner to enrol the first authenticator. Options: shorten the default (suggest 60 minutes), tie enrolment to a one-time token in a "reset applied" mail, or keep 24 h. [medium] [0128 `recovery_enrol_window_minutes`] (acceptance-auditor + blind-hunter)
  - RESOLVED (D4 a): `recovery_enrol_window_minutes` default 60.
- [x] [Review][Patch] Step-up check fails open — `requestRecoveryEmailCode` ignores a `recovery_status` error, treats it as "no email" and skips the step-up for changing an existing address; return the generic error instead. [medium] [apps/super-admin/app/(admin)/security/recovery-actions.ts:~46] (blind-hunter + edge-case-hunter)
  - RESOLVED: status error or missing row now fails closed with the generic error; test added.
- [x] [Review][Patch] SMTP can be downgraded — `lib/mail.ts` only sets `secure` for port 465 and never `requireTLS`, so on 587/25 a network attacker can strip STARTTLS and read the Resend key and codes; require TLS whenever credentials are set or the host is not local. [medium] [apps/super-admin/lib/mail.ts:~35] (blind-hunter + edge-case-hunter)
  - RESOLVED: `requireTLS` when credentials are set or the host is not local (and not on implicit-TLS 465); tests added.
- [x] [Review][Patch] Audit attribution — `private.recovery_audit` always writes `actor_id` null, so authenticated flows (set/remove recovery email, register code request) cannot be attributed to the Super Admin; spec says "the user" when authenticated. Pass the user id for those calls. [medium] [0128 `recovery_audit` and its callers] (acceptance-auditor)
  - RESOLVED: `recovery_audit` takes `p_actor_id`; set, remove and owner-cancel rows carry the user; pgTAP asserts no null actor on set/remove.
- [x] [Review][Patch] Missing tests for specified behaviour — (a) `issueStepUp` with `change_recovery_email` / `remove_recovery_email`; (b) `cancelRecovery` (short token, ok true/false, rpc error); (c) the public `recovery_*` wrappers called as service_role asserting the returned column names the app reads; (d) pgTAP: enrolment window expiry and non-admin/locked accounts, `recovery_email_remove` cancelling a pending reset, apply cancelling when the email was removed, daily and `recover`-purpose rate limits. [medium] [step-up-actions.test.ts, auth/recovery/cancel, supabase/tests/super_admin_recovery_email.test.sql] (verification-gap + blind-hunter)
  - RESOLVED: step-up new actions, cancel action, owner sign-in cancel, notices; pgTAP +13 (window expiry/locked/non-admin, removal cancels pending, apply cancels without email, daily and recover-purpose limits, owner cancel, actors). Public wrappers smoke-tested through live PostgREST as service_role (column names match) and anon refused (401).
- [x] [Review][Patch] `SUPER_ADMIN_APP_URL` is used as given — a value without a scheme, or `http` in production, produces unusable or insecure cancel links in the notice mails; parse it, keep only the origin, require https in production. [low] [apps/super-admin/lib/recovery.ts:~20] (edge-case-hunter)
  - RESOLVED: `appBaseUrl` keeps only a bare origin, https required in production; tests added.
- [x] [Review][Patch] decisions.md says notices go to "BOTH mailboxes", but only the login mailbox is enforced (its failure cancels the schedule); the recovery-mailbox send is best effort. Correct the wording. [low] [docs/decisions.md Story 22.8 entry] (edge-case-hunter)
  - RESOLVED: decisions.md wording corrected.

#### Rejected

- `false` — "no lockfile change in the diff": the lockfile is committed (18 lines); the review diff excluded it.
- `false` — decisions.md "config check requires > 0" is unbacked: `session_limits_config_value_check` (0127) is that check.
- `false` — the database does not enforce step-up on replacing the address / verify can bypass it: the functions are service_role only, one live code per purpose means no second-tab race, and 22-7 uses the same app-enforced design.
- `false` — `/auth/mfa` page 500s if the admin client throws: the app cannot run without that env anyway, and an rpc error returns `data: null`, which falls through to the normal prompt.
- `false` — cancel and enrol routes are missing from the proxy allowlist: `/auth/*` is exempt and `/auth/recovery/cancel` returned 200 signed out.
- `low` — step-up spent when the code issue is refused: reordering would mail a code before the step-up; a retry costs one more authenticator code.
- `low` — compensating `recovery_cancel` unchecked and audited as `email_link`: needs a failing second DB call; cosmetic attribution.
- `low` — `login_email` null or equal to the recovery email: `String(null)` makes the send fail, which cancels the schedule (fails safe).
- `low` — response timing differs on the sent path: the caller is already authenticated as that user, so it reveals only their own state.
- `low` — UI polish: `askForCode` without try/catch, stale modal error, no redirect on `account_locked` in the card, `/security` replaced by a load error if the recovery read fails, cancel page shows "invalid" on a network error, no resend / pending state on the prompt.
- `low` — `recovery_apply_due` batch rolls back on one bad row: no known way for the deletes to fail; an exception block would add branches.
- `low` — rate-limit count/insert race: each request kills the previous code, so only one live code exists.
- `low` — no email length cap, non-string `to`/`subject`, empty `MAIL_SMTP_PORT`: typed callers only; the empty port fails closed.
- `low` — expiry "10 minutes" hard-coded in the mail text: wrong only if an operator changes the TTL; fix needs a new RPC return column.
- `low` — orphan factor if rollback `unenroll` fails; `super_admin_mfa_enrolled` audited before verify; UTC in mail vs local time in UI; cancel-token index not unique; step-up action list repeated in four places; `@types/nodemailer` ^8 with nodemailer ^7 (tsc is clean); no `Referrer-Policy` on the cancel page; no UI component tests.
- `low` — rate limit counted per purpose: the config note says so deliberately; max is 6/hour in total.
- `low` — wrong-attempt accounting skips expired or missing codes: spec lists those as plain "refused".
- `low` — recovery works with the flag off: only reachable after an applied recovery or by requesting one; harmless.
- spec-edit — masked address not shown after a request: contradicts the no-enumeration rule; the fix would edit the spec.

## QA and close-out (2026-10-17)

- Local browser QA by the owner, checklist section F: items 34-37 and 39 passed (set/change/remove with step-up, recovery request, reset applied after the delay, enrol window). Item 38 (cancel link) verified in the audit log and Mailpit: audit `by: email_link`, both mailboxes got the cancelled notice. Item 41 (enable rule) and 42 (operator `--cancel-recovery`) verified from the scripts. Still NOT run end to end in a browser: item 43 (owner aal2 sign-in cancels a pending recovery; covered by Vitest and pgTAP), item 40 (identical answer for non-admin / no recovery email), and the reused-link and polling-switch observations of item 38.
- Fixes found during QA: login page read `searchParams` outside Suspense (Next 16 blocking-route error, from 22.7); sign-in prompt now polls `recoveryProgress` every 15 s, moves on when the reset applied, shows a cancelled message, and offers a "Go to sign in" button after 2 minutes.
- Local `PGRST303 JWT issued at future` on `/gyms` is WSL clock skew, not app code.
- `scripts/ci-local.sh` GREEN for 9183785 (stamp written). Local QA environment torn down (accounts, factors, recovery data, audit rows, mail, `.env.local` mail lines; flag OFF; limits at defaults).
- Open before `done`: Resend domain `gymosapps.com` verified and prod env vars set by the owner (not testable until migration 0128 is applied to production at epic end); owner sign-off on the browser items above; a mail when a reset applies was deliberately not built (no scheduler).

## Production and sign-off (2026-10-19)

- Migration 0128 reached production on 2026-10-17 with 0124-0130 (`scripts/deploy-0124-0130.sh`); code deployed by PR #77 (master `02cdb25`). The open items above are closed: the Resend domain `gymosapps.com` is verified and the Vercel env vars are set.
- **Production proof of the registration half:** the owner registered the Super Admin's recovery email on 2026-10-19 (code issued 13:56 UTC, entered at 13:57 UTC with 0 wrong attempts, audit `super_admin_recovery_email_set`, one verified row). Getting there took four failed sends: Resend refused `MAIL_FROM="GymOS <hello@gymosapps.com>"` with `EMESSAGE`; the bare `hello@gymosapps.com` worked. PR #78 now logs the SMTP refusal text; PR #79 adds an optional `MAIL_FROM_NAME` so the mailer builds the display name.
- **Not proven in production:** the sign-in recovery (code, 30-minute delayed reset, cancel link). It was proven locally (checklist F, items 34-40, 43) and is not exercised on production because doing so would remove the Super Admin's only authenticator. The `super_admin_aal2` flag was enabled on 2026-10-19 with one verified factor plus this verified recovery email, and a code sign-in was confirmed.
- Owner sign-off: given 2026-10-19 ("run the retrospective and close review on 22-8"). Story closed `done`.
