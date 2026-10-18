# Epic 22 Context: Secure Sign-In Foundation — Access Ends Immediately, Second Factor for Super Admin and Support

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make deactivation, removal, lock or unassignment take effect on an account's next request for every role (not at token expiry), and put a TOTP second factor (AAL2) in front of Super Admin. The shared second-factor gate, session limits and step-up are built here so Epic 23 (GymOS Support) can use them. This completes the live-authorization retrofit started by the earlier role-check work. Production has real gyms, so authorization changes ship behind the full local CI gate and the RLS/role matrix tests.

## Stories

- Story 22.1: Spike — Claims Hook `aal`, Factor-Enrollment Guard, Session Deletion, Cookie Behavior
- Story 22.2: Claim-Read Inventory & CI Check (Report Mode)
- Story 22.3: Live Authorization in the Database
- Story 22.4: Live Authorization in Edge Functions & Service Paths
- Story 22.5: Super Admin Second-Factor Enrollment (Flag Off)
- Story 22.6: Super Admin Bootstrap, Second Device & Recovery
- Story 22.7: Session Limits & Step-Up

## Requirements & Constraints

- Unassigning, removing, deactivating, locking, or opt-out ends access on the very next request; every role-gated policy, RPC, edge function and service path checks live membership, role, deactivation state (and, for support, assignment, opt-out and factor level). A suspended gym is denied like any staff account.
- Support and Super Admin sessions must be AAL2 and enforced in the database and every edge/service path through one shared check; no entry path or old client build may bypass it.
- Super Admin AAL2 is switched on only after the account has enrolled and verified its factor in a controlled bootstrap; once on, enrollment is never open to an unverified session. Recovery must not lock out the sole Super Admin.
- Session limits: support 8 hours absolute and 15 minutes idle; Super Admin 8 hours and 30 minutes idle (assumption), enforced by the application from server-recorded state.
- Null-safety: authorization helpers must fail closed (NULL/deny), never raise open.
- Auth cookies for dashboard and super-admin must have no Domain, Path=/, Secure, SameSite=Lax and the `__Host-` prefix (subject to the spike result).

## Technical Decisions

- Live helpers: `private.current_member_role()` and `private.current_gym_status()` (STABLE, live lookups) replace claim-only `auth.jwt() ->> 'app_role'` reads; `gym_id` stays claim-derived except for support. A CI inventory of claim reads fails on new claim-only entries beyond a committed baseline (an `exempt` entry needs a one-line reason).
- Gate is split: a read side (STABLE, returns role only when all live conditions hold, including `aal2` and `session_id` still in `auth.sessions`) and a write side (VOLATILE touch recording last-seen; limit breaches returned as results, not raised). Edge functions and service-role code call one shared authorization function with the actor passed explicitly (no claims on service paths).
- The claims hook emits support claims only at aal2 — the hook receiving `aal` is an unverified assumption resolved by the 22.1 spike. The hook's most-recent-membership fallback is disabled for support, and hook errors omit claims (fail closed).
- The Super Admin app is a path too: today the hook emits `super_admin` at aal1, so layouts and Server Actions must enforce AAL2 once the platform flag is on.
- Factor enrollment/removal runs only in a server function that checks the session's `aal` first; the client enroll call is not used. If the spike shows a direct provider call can add a factor at AAL1, a database-level guard is required.
- Super Admin holds two verified factors on separate devices (TOTP has no native recovery codes); a platform flag controls AAL2 enforcement and is flipped once by a one-time script after both factors verify.
- Session and step-up state is application-owned: `support_session_state(session_id, started_at, last_seen_at)` and `support_stepup(user_id, action, subject_id, expires_at, consumed_at)`. Step-up is a fresh TOTP verified server-side, valid 5 minutes, single-use, bound to action and subject, keyed to the user (not the session), and does not read `amr`. Factor reset/lock/removal clears session state and deletes the user's `auth.sessions`. Wrong-code lockout is an application counter that locks the account for Super Admin review.
- Ending access relies on deleting `auth.sessions` rows; whether that refuses the next request and invalidates refresh tokens is a spike item.
- Decisions are recorded as a dated entry in `docs/decisions.md`; the spike updates the Deferred bullet in `ARCHITECTURE-SPINE.md`.

## Cross-Story Dependencies

- Two chains converge at 22.7: 22.1 → 22.2 → 22.3 → 22.4, and 22.1 → 22.5 → 22.6; 22.7 needs 22.4 and 22.6.
- 22.1's findings may change later stories (claims hook aal, enrollment guard, session deletion, cookies).
- 22.3, 22.4 and 22.7 add migrations numbered at merge time; 22.6 is run by the product owner, not CI, because it can lock out the sole Super Admin.
- Epic 23 (support) depends on this epic; 22.7's limits and step-up serve its money-moving actions.

## Spike Results (22.1, resolved 2026-10-15; local stack only)

- The claims hook receives `aal` at `event.claims.aal` on every mint including refresh; read it fail-closed (`coalesce(..., 'aal1')`) and emit `super_admin`/`support` only at `aal2`.
- Provider already refuses adding or removing a factor from AAL1 once one verified factor exists; the gap is the first-factor window (a password holder with no factor can enroll and verify at AAL1). No trigger on `auth.mfa_factors` (owned by `supabase_auth_admin`); the guard is the server-function path plus a test recording this.
- Deleting `auth.sessions` rows stops refresh and `/auth/v1/user` but PostgREST accepts the old access token until expiry (≤1 h), so live helpers must check `session_id` exists in `auth.sessions` via a SECURITY DEFINER helper.
- Service role can remove a factor via the admin API; a reset reopens the first-factor window, so keep the account locked until the new factor verifies.
- `__Host-` cookies hold only with `secure: true` set explicitly; changing cookie names signs everyone out once and isolates hosts.
- Local `config.toml` needs `[auth.mfa.totp] enroll_enabled/verify_enabled = true` for 22.5 tests. Hosted factor cap (10) and TOTP setting are not independently verified.
