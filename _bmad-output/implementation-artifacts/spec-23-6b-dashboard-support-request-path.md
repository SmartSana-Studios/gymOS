---
title: '23-6b Dashboard support request path'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: 'd29e623fc1c41ebf15d5f4adc4e93212894b8b21'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No support session can use the Owner dashboard: it never asks for the authenticator code, never calls `session_gate_touch` (so the live gate, velocity lock and session limits never run), picks a gym by itself, and does not admit the `support` role. Several allow-listed paths are unreachable and several deferrals name this story.

**Approach:** Add the dashboard request path for support: second-factor step after password sign-in, an explicit gym picker, one gate call in the request proxy, `support` admitted in the shell, nav and role lists, and the database changes the dashboard needs (migration 0146). Step-up UI is 23-6c.

## Boundaries & Constraints

**Always:** Migration 0146 with a rollback script. The gate is called from the dashboard proxy for every request whose JWT is `aal2` (only support holds a factor there), so pages, Server Actions and route handlers are covered by one place; a failure or any non-ok result signs the session out locally and redirects to `/auth/login?expired=1` (fail closed). A support request acts on exactly one explicit gym: the hook never picks a support gym by default, `support_begin_session()` clears `active_gym_id` after the code is verified, and the picker's `switch_active_gym` sets it. `authorize_action` gets an optional `p_session`; a `support` actor is allowed only when the capability lists support AND `private.support_live_for(user, gym, session)` is true (the same checks as `support_live`, with the session's `aal` read from `auth.sessions`). Nav and pages show only what the allow-list covers; the database stays the real enforcement. Failure messages are generic and never name the person. Bilingual EN/FR.

**Never:** No change to non-support sign-in (staff with no factor never see the code step). No step-up UI (23-6c). No kill switch. Do not enable support for any gym. No individual name, phone or email in any gym-side surface (the shell shows "GymOS Support").

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Support sign-in | Password OK, verified factor | `/auth/mfa` code step, then `/support-gym` picker, then dashboard in the chosen gym | Wrong code: one generic message, retry |
| Picker | Several active assignments | Lists those gyms only; no default | None active: "no gym assigned" and sign out |
| Staff sign-in | No factor | Straight to dashboard as today | N/A |
| Request, live | aal2, gate ok | Page renders as role `support` | N/A |
| Request, locked or expired | Gate returns locked / session_expired | Signed out, login shows the expired banner | Fails closed on RPC error |
| Revoked mid-session | Unassign or switch off, JWT still carries the gym | Next request sends the person back to the picker (inside 60 s) | N/A |
| Capability | Support asks `staff.create`, `member.provision`, `member.registration_fee_state`, `payment.initiate_staff` | Allowed only if live; denied otherwise | typed permission_denied |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql` -- hook and `switch_active_gym`; hook's fallback query picks a default gym (must exclude support).
- `supabase/migrations/0145_support_lifecycle.sql` -- current `support_live` / `session_gate_touch` (reuse; do not change the gate).
- `supabase/migrations/0125_authorize_action.sql`, `0132_*` -- `private.authorize_action`, `private.capability_roles`; policy `read gyms of own active memberships` (0065) admits stale support rows; add `support_read_own_gym` via `private.support_gym_id()`.
- `apps/dashboard/lib/supabase/proxy.ts` (+ `proxy.test.ts`) -- add the gate call after `getClaims`; keep existing exemptions.
- `apps/dashboard/components/login-form.tsx` -- after sign-in, `mfa.getAuthenticatorAssuranceLevel()`: `nextLevel=aal2` goes to `/auth/mfa`; show the `expired` banner.
- `apps/super-admin/components/mfa-form.tsx`, `app/auth/mfa/page.tsx` -- the pattern to copy for the dashboard code step.
- `apps/dashboard/services/session.ts` -- `STAFF_ROLES` and shell context; `switchActiveGym`; add `listSupportGyms`.
- `apps/dashboard/app/(dashboard)/layout.tsx`, `components/shared/Sidebar.tsx`, `TopBar.tsx`, `GymSwitcher.tsx`, pages with role lists (`page.tsx`, members, payments, plans, subscriptions, settings, staff).
- `apps/dashboard/lib/authz.ts`, `supabase/functions/payment-webhook/_shared/authorize.ts` -- pass the session id to `authorize_action`.
- `supabase/tests/` -- new `support_request_path.test.sql`; catalog tests below.
- `scripts/epic23-qa/` -- extend `smoke.mjs`; README rows for the browser flow.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0146_support_request_path.sql` + rollback -- hook fallback excludes support; `support_begin_session()`, `list_own_support_gyms()`, `support_live_for()`, `authorize_action(p_actor,p_gym_id,p_capability,p_session default null)` with the support branch, `capability_roles` lists support for the four capabilities, `support_read_own_gym` policy and the memberships policy excludes support -- so the request path exists and no default gym is possible.
- [ ] `apps/dashboard/lib/supabase/proxy.ts` -- gate call for aal2 requests, revoked-mid-session redirect -- one place covers every consumer.
- [ ] `apps/dashboard/app/auth/mfa/*`, `app/support-gym/*`, `login-form.tsx`, `services/session.ts`, shell, nav, role lists, EN/FR strings -- sign-in code step, picker, role admitted, expired banner.
- [ ] `apps/dashboard/lib/authz.ts` and the edge `authorize.ts` -- send `p_session`.
- [ ] `supabase/tests/support_request_path.test.sql` -- hook never defaults a support gym; picker list; `support_begin_session`; capability matrix live vs not (locked, recert, switch off, expired); catalog: every caller of `current_gym_status()` listed with role-before-suspension; every audit action type written by an allow-listed support RPC is in `private.support_audit_actions`; every table in the Realtime publication that support can read is reachable only through the live gate.
- [ ] Vitest -- proxy (gate runs for aal2 and for a Server Action POST, denied on `locked`, fail closed), login routing, MFA form, picker, shell role, scan that no gate exemption exists beyond the auth exemptions.
- [ ] `scripts/epic23-qa` -- `smoke.mjs` runs the request path; README browser rows.

**Acceptance Criteria:**
- Given a support person with a factor, when they sign in on the dashboard, then they must pass the code step and pick a gym before any data loads.
- Given a locked, expired, revoked or recertification-lapsed support session, when any request arrives, then it is refused or redirected within 60 s and nothing renders.
- Given the Owner payments form, when a live support person opens Settings, then the 23-9 connect flow is reachable end to end.
- Given the closing checklist, when this story is done, then every deferred-work entry naming 23-6b is closed or re-homed with a reason.

## Implementation Notes

Built per the spec: migration 0146 (+ `scripts/rollback-0146-support-request-path.sql`), proxy gate, `/auth/mfa`, `/support-gym`, shell/nav/role lists, EN/FR, `p_session` in `lib/authz.ts` and the edge `authorize.ts`. Revoked-mid-session is detected in the proxy with `list_own_support_gyms()`. Tests: `supabase/tests/support_request_path.test.sql`, `proxy.gate.test.ts`, login/mfa/picker/Sidebar/shell tests, `_shared/authorize.test.ts`, `smoke.mjs`. Deferred-work closure at the end of deferred-work.md; decisions.md has the entry.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Idle limit defeated: proxy touches the gate for /api/version polled by every open tab | medium | patch | Confirmed: UpdateNotice.tsx polls /api/version; the gate heartbeats on it. Fix: do not run the gate for that tenant-free path. |
| 2 | needsPicker redirect drops refreshed auth cookies | medium | patch | Confirmed in proxy.ts: expired branch copies supabaseResponse cookies, picker branch does not. |
| 3 | safeRedirectPath misses tab/newline (`/\t/evil.com`) | medium | patch | Confirmed: only `//` and `/\\` prefixes checked; browsers strip tab/CR/LF. New use in picker and code step. |
| 4 | login-form ignores getAuthenticatorAssuranceLevel error | low | patch | Fails to aal1 (no gym claim) so no leak, but should fail closed; direct fix. Same for /auth/mfa page. |
| 5 | MfaForm: begin_session or refresh failure leaves old active_gym_id and shows "invalid code" | medium | patch | Failure path leaves an aal2 token that may carry the last gym; fix: sign out and show a neutral error. |
| 6 | Residual: a person who verifies then navigates away before begin_session keeps the last gym | medium (unverified) | defer | Needs a per-session pick in the hook; contradicts the frozen "clears after the code is verified"; owner decision. Still only a gym they are assigned to. |
| 7 | support_live_for lets a session act on another assigned gym on service paths | medium | patch | Confirmed by reading authorize_action: gym is the target row's. Fix at both callers: a support actor must target the JWT's gym_id. |
| 8 | Ledger export role list not pinned for support | low | patch | payments.listAllPayments.test.ts has no support case; trivial test. |
| 9 | Edge index.test.ts does not assert p_session forwarded | medium | patch | Removing the argument fails closed in production with no test failing; one assertion. |
| 10 | Overview redirect for support untested | low | patch | One test beside page.coachRedirect. |
| 11 | README S9 SQL has no WHERE | low | patch | Confirmed; QA kit only; add WHERE for the QA person. |
| 12 | Refund/waiver/staff controls shown before 23-6c exists | low | false | Resolved by 23-6c, the next story on this epic; allow-list does cover them. |
| 13 | Role-widening UI render tests per component | low | rejected | DB is the enforcement; fix would be many parametrised tests, unlikely to bite. |
| 14 | support_live_for copies support_live with no parity test | low | defer | Real drift risk; sharing one core changes the gate, which this story must not. |
| 15 | No route guards for non-allow-list pages | low | rejected | RLS returns nothing; cosmetic. |
| 16 | 307 for Server Action/API denial | low | rejected | Same pattern as the existing unauthenticated redirect. |
| 17 | aal2 equals support is unenforced | low | rejected | No other role holds a factor on this app; stated in comments. |
| 18 | Duplicate per-request RPCs | low | rejected | Support-only requests. |
| 19 | MfaForm retries all factors, no digits validation | low | rejected | Copied from the Super Admin pattern. |
| 20 | window.location test leaks; picker token refresh; missing i18n keys | low | false | switchActiveGym already refreshes the session; i18n parity passes. |
| 21 | Rollback fidelity; deferred-work field swap; decisions count | low | false | Rollback rehearsed in a rolled-back transaction; the deferred-work entry reads correctly; test pins the 35 objects. |

## Design Notes

The gate sits in the proxy rather than in each action because `session_gate_touch` already covers any aal2 session and the proxy sees every request; the scan test fails if a route is added that bypasses it. `support_live` needs the caller's own JWT, which a service-role `authorize_action` call does not have, so `support_live_for` takes the verified session id and reads the level from `auth.sessions`.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN on a pristine database (run `supabase db reset` first).
- `node scripts/epic23-qa/seed.mjs && node scripts/epic23-qa/smoke.mjs` -- expected: all passed.

**Manual checks (if no CLI):**
- Browser: sign in as `qa23-active@gymosapps.com`, enter the code, pick Gym A, open Members, then unassign in Super Admin and reload: back at the picker.
