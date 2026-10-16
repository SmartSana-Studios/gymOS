---
title: 'Session limits and step-up (Super Admin)'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: 'cc703f98b05938009d3d130af76416b604cae289'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-6-super-admin-bootstrap-second-device-and-recovery.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** With `super_admin_aal2` on, a Super Admin session never expires on idle or age, and a stolen or forgotten signed-in session can run any platform action. There is also no application counter for wrong second-factor codes.

**Approach:** One migration adds `support_session_state`, `support_stepup` and a single limits/lockout configuration table, plus the gate, step-up and lockout functions. The Super Admin app calls the gate on every request (layout and Server Actions), shows a "session expired" re-sign-in prompt, and requires a fresh single-use, action-and-subject-bound TOTP step-up for the actions named below. Epic 23 reuses the same objects for support.

## Boundaries & Constraints

**Always:** Limits apply only while `super_admin_aal2` is on; flag off behaves exactly as today. Limits (8 h absolute, 30 min idle, step-up 5 min, wrong-code threshold) live in one table, tagged `[ASSUMPTION]`, read only by the gate functions; a test asserts the gate reads them from there. Gate "touch" is VOLATILE and returns breach/lock as a result row, never raises. Step-up is keyed to the user, never reads `amr`, is verified server-side, and is consumed atomically (one UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()). A breach deletes that user's `auth.sessions` row and `support_session_state`; `private.is_super_admin()` / `_live()` also require the JWT `session_id` to exist in `auth.sessions` while the flag is on (the 22.1 finding). Lock, factor reset, and removal clear state and sessions. Wrong-code attempts are audited with counts only, never a code. Strings en and fr. Migration number is the next free at merge time.

**Decisions (human, 2026-10-16):** Step-up is required only for removing a Super Admin factor and for creating or promoting a Super Admin; billing and gym actions are unchanged. The wrong-code lockout counts step-up attempts only; the `/auth/mfa` sign-in prompt is not counted, so a password holder cannot lock the sole Super Admin out.

**Never:** No support role, support assignment or `support_gate_touch` velocity (Epic 23). No provider plan session settings. No change to flag-off paths, claims hook, or 22.5/22.6 enrollment rules. No secret or code in logs or audit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active session | flag on, within limits | touch updates `last_seen_at`, request proceeds | N/A |
| Idle | `last_seen_at` older than idle limit | denied, session removed, redirect to login with "session expired" | N/A |
| Too old | `started_at` older than max age | same as idle | N/A |
| Step-up ok | fresh TOTP, action A, subject S | one row valid 5 min; action on A+S consumes it | wrong code: audited attempt, row not created |
| Step-up misuse | reused, other subject, other action, expired | refused | permission_denied |
| Lockout | wrong-code count reaches threshold | account locked, sessions removed, audited, returned as result so it commits | cleared by the reset script |
| Flag off | any | no state written, no limits | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0126_super_admin_aal2_flag.sql` -- flag, `private.is_super_admin()`/`_live()` bodies to extend with the `session_id`-in-`auth.sessions` check; `public.super_admin_aal2_required()` service wrapper pattern.
- `supabase/migrations/0125_authorize_action.sql` -- private core plus service_role-only public wrapper pattern to copy for gate/step-up functions.
- `apps/super-admin/lib/authz.ts` -- `authorizePlatformAction`/`requireSuperAdminAal2`: add gate call and a `session_expired` reason.
- `apps/super-admin/app/(admin)/layout.tsx` -- redirect `session_expired` to `/auth/login?expired=1`.
- `apps/super-admin/app/(admin)/security/actions.ts`, `admins/actions.ts` (and billing/gyms per Q1) -- step-up consumption.
- `apps/super-admin/components/mfa-form.tsx`, `app/auth/login` -- reuse challenge UI for step-up dialog; expired message.
- `scripts/reset-super-admin-factors.mjs` -- also clear lock and session state.
- `supabase/tests/` -- new pgTAP suite; `docs/decisions.md`, `docs/runbooks/super-admin-recovery.md`, sprint-status.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/NNNN_session_limits_step_up.sql` -- tables, limits config, gate/touch, step-up issue/consume, lockout counter, session-exists in helpers, rollback script
- [x] `supabase/tests/session_limits_step_up.test.sql` -- matrix rows, config-read assertion, atomic single-use
- [x] `apps/super-admin/lib/authz.ts`, `layout.tsx`, login page, locales en/fr -- gate, expired prompt
- [x] step-up server action, dialog component and per-action wiring (per Q1) -- Vitest per action
- [x] `reset-super-admin-factors.mjs`, runbook, `docs/decisions.md`, `sprint-status.yaml`

**Acceptance Criteria:**
- Given flag on and an idle or over-age session, when any admin route or action is requested, then it is denied, the session is gone and the login page says the session expired.
- Given a valid step-up, when the bound action runs once, then it succeeds and a second run is refused.
- Given `scripts/ci-local.sh`, when run, then GREEN.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| Locked clause in is_super_admin/_live untested | medium | helpers asserted only before lockout block; deleting the clause keeps suite green. patch (test) |
| Privilege grants barely asserted | medium | one OR-ed assertion covers 2 of 4 public wrappers, no private.*. patch (test) |
| removeFactor step-up binding unasserted | low | consumeStepUp mock args never checked. patch (test) |
| Reset script lock/state clearing untested | medium | no assertion in super-admin-aal2.test.sh. patch (test) |
| removeFactor does not end sessions (spec Always: removal clears state and sessions) | medium | actions.ts removeFactor unenrolls and audits only. patch: admin global signOut, no new surface |
| Duplicate live grants for same user/action/subject give two uses | medium | stepup_issue inserts without removing unconsumed twins. patch |
| stepup_record_failure RPC error leaves wrong guess uncounted | medium | step-up-actions.ts falls through to invalid_code. patch (fail closed) |
| Runbook says limits change is audited, no audit exists | low | config table has no audit trigger. patch (doc wording) |
| First touch seeds last_seen_at = now(), idle not evaluated once | low | real but only for sessions with no state row (rollout, post-clear); absolute age still from auth.sessions.created_at. rejected: fix adds branches |
| Flag-off path calls gate RPC; fails closed if 0127 not applied | low | migrations deploy before app per runbook order. rejected |
| Server Actions show permission_denied not "session expired" | low | session is removed and next navigation shows the expired notice. rejected |
| Wrong-code counter has no time window | low | spec says counter reaches limit; consecutive by design, reset script clears. rejected |
| Orphaned support_session_state rows; per-call write cost | low | few admins, one row per session, gate deletes on next touch. rejected |
| Grant burned when unenroll/lookup fails after consume | low | user re-enters a code. rejected |
| Whitespace subject, factor-id case mismatch, retry loop, session_gate_unavailable message, reset script on un-migrated DB | low | harmless or unreachable (factor ids are lowercase uuids; operator runs after migration). rejected |
| Redirect loop on /auth/login?expired=1 | false | login page does not redirect authenticated users |
| no_session branch dead in layout | false | authorizePlatformAction returns no_session when getUser fails |
| jwt_session_alive fails for tokens without session_id | false | GoTrue always sets session_id; 22.5 suite updated with a session fixture |
| Limits config has no upper bound | low | operator-only table, rejected |
| Spec bookkeeping stale | low | handled by step 6 task marking |

## Verification

**Commands:**
- `supabase test db` -- expected: new suite and existing suites pass
- `pnpm --filter super-admin test` -- expected: pass
- `node scripts/check-i18n-key-parity.mjs` -- expected: clean
- `bash scripts/ci-local.sh` -- expected: GREEN
