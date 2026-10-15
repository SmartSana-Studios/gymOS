---
title: 'Live authorization in edge functions and service paths'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '3f34fd6d46c801dbf0e0b57006f7b30ebf95cf85'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/scripts/claim-inventory.mjs'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Server code that holds a service-role key authorizes its caller from a token claim, from the request body, or not at all, so a deactivated or demoted actor can still create auth users, send messages, read audit data or start a payment at the edge.

**Approach:** One shared `authorize_action(actor, gym_id, capability)` that takes the actor explicitly and loads membership, role, deactivation and gym state from the database, returning allow or a typed deny. Every user-initiated service-role path calls it before any write or provider call. The claim-inventory check becomes enforcing.

## Boundaries & Constraints

**Always:** The actor id comes from a verified session (`getUser()`/JWT verification), never from a body or argument; the gym id comes from the target row where one exists. Capabilities are an enumerated allow-list (capability -> allowed roles) in one place. A denial has no side effect, returns the stable `permission_denied` code (en/fr copy, mobile included), and is logged without token or secrets. `payment-webhook` signature authentication is unchanged and stays exempt, as do `gym-qr-display` (device bearer), `send-sms-hook` (signed hook) and the cron route (`CRON_SECRET`).

**Never:** No change to RLS or the 0124 helpers. No new edge function (count stays 3). No `session_id` / `aal` logic (22.5, 22.7). No change to the password step-up of super-admin promotion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deactivated staff | valid token, member row deactivated, calls create staff | denied before `auth.admin.createUser`; no auth user created | `permission_denied`, one logged event |
| Role changed | token `manager`, now `receptionist`, capability needs manager | denied | same |
| Wrong gym | actor active in gym A, target row in gym B | denied | same |
| Edge initiate | no/invalid JWT, or actor not owner of the payment's member / not staff of its gym | 403 `{code:"permission_denied"}`, provider never called | logged without token |
| Edge initiate ok | member pays own payment, or staff of the row's gym, or owner for SaaS billing | unchanged behavior | N/A |
| Super Admin | live `is_super_admin` true | allowed; flag off: denied even with a stale claim | N/A |
| Webhook | provider-signed request | unchanged, never routed through authorize_action | N/A |

</frozen-after-approval>

## Code Map

- Gaps found by the investigation: `apps/dashboard/services/staff.ts createStaffMember` (admin createUser before the RPC), `members.provisioning.ts findOrCreateUserByPhone` and `settleRegistrationFeeForImport`, `members.detail.ts getMemberRegistrationFeeState` (service-role audit read gated by claim role and claim gym), `apps/super-admin/app/(admin)/billing/actions.ts triggerRetry`, `gyms/actions.ts createGym`, `admins/actions.ts createOrPromoteSuperAdmin` (claim role gate), `(admin)/layout.tsx` (claim role page guard), `supabase/functions/payment-webhook/index.ts handleInitiate` and `handleInitiateLink` (no JWT, no actor).
- Already live through RPCs after 0124 (call `authorize_action` only for uniformity where cheap): `resendStaffTempPassword`, `updateStaffRole`, `deactivateStaffMember`, payment-provider connect/disconnect, billing RPCs, gym status actions. Check `revokeGymAccess(gymId, actorId)`: the RPC must derive the actor from `auth.uid()`.
- `apps/*/lib/supabase/admin.ts` -- service-role client factories; the authorize call goes before them.
- `packages/types/src/errors.ts` + locale files -- add `permission_denied`, a predicate, en/fr copy; mobile has its own locales; edge returns `jsonResponse(403, {code})` and mobile reads `invokeError.context.json().code`.
- Sentry: no explicit capture exists in app server code (only instrumentation). Dashboard/super-admin denial -> `Sentry.captureMessage` with actor id, gym id, capability only. Edge functions have no Sentry SDK; log a structured console line.
- `scripts/claim-inventory.mjs` + `scripts/claim-inventory.baseline.json` + `scripts/claim-inventory.exempt.json` -- add enforcing mode; exempt reasons for the four exempt paths.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0125_authorize_action.sql` + `scripts/rollback-0125-*.sql` -- `private.authorize_action(p_actor uuid, p_gym_id uuid, p_capability text)` SECURITY DEFINER, granted to `service_role` only, revoked from public/anon; capability allow-list inside; typed result (allowed, reason code, role). One definition serves Deno and Node, so no copies diverge; this is the one deviation from the epic table's "no migration" and is additive
- [x] thin wrappers -- `apps/dashboard/lib/authz.ts`, `apps/super-admin/lib/authz.ts`, `supabase/functions/payment-webhook/_shared/authorize.ts`; denial logging; `permission_denied` mapping
- [x] call sites -- the gaps listed in the Code Map, before any admin client use or provider call; edge initiate routes verify the JWT first
- [x] `scripts/claim-inventory.mjs` and baseline -- enforcing mode (fail on any non-exempt `claim-only`/`null-unsafe`); layout and admins server sources no longer read the claim role
- [x] tests -- pgTAP for `authorize_action` per role and capability; Vitest per call site (no side effect on denial, `createUser` not called); Deno test for edge initiate (no JWT, wrong actor, ok); script tests for enforcing mode
- [x] `docs/decisions.md`, `sprint-status.yaml`

**Acceptance Criteria:**
- Given any listed gap site, when a deactivated, role-changed or wrong-gym actor calls it, then it returns `permission_denied` with no side effect.
- Given the inventory in enforcing mode, when `pnpm run check:claims` runs, then the baseline has zero non-exempt entries and a new claim-only source fails.
- Given an older mobile or dashboard build, when it hits a denying path, then it shows the existing "no permission" outcome, not a network error.
- Given `scripts/ci-local.sh` and the Playwright baseline, when run, then both pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| authorize_action denies billing.saas_pay when gym not active | high | patch | decisions.md: an Owner of a suspended gym must still reach billing; the status check runs for every gym capability, so the Owner cannot start the payment that reinstates the gym |
| settleRegistrationFeeForImport authz not pinned by a test | medium | patch | denial test trips at findOrCreateUserByPhone first; removing the settle check passes all tests |
| listSuperAdmins and (admin) layout denial untested | medium | patch | no test references them; removing the check passes all tests |
| SaaS and initiate-link happy tests do not assert p_gym_id | low | patch | fixtures carry no gym_id; a null gym on the success path would pass |
| QA script echoes stale expected output | low | patch | script gets 403 without a bearer |
| multi-row role pick arbitrary | false | reject | unique index idx_members_active_gym_user allows one active row per (gym,user) |
| getMemberRegistrationFeeState authorizes claim gym, not row gym | false | reject | audit query filters the same gymId that was authorized |
| initiate callers might not carry the user JWT | false | reject | billing.ts and payments.ts invoke via the user session client |
| 403 vs 400 payment-id existence oracle | low | reject | UUIDs; fix changes response semantics |
| member lookup error downgrades to staff capability | low | reject | fails closed; only the reason text is misleading |
| denied() translation failure throws | low | reject | still no side effect; fix is a guard for an unlikely case |
| layout redirect on transient failure; Sentry noise; duplicated constant; unused predicate | low | reject | cosmetic or unlikely |
| older build shows generic failure, not no-permission text | low | reject | released builds cannot change; handled invoke error, not a crash |
| per-row auth round trips in import loops | medium | defer | performance only |
| initiate-link success path untested | maybe-false | defer | blocked by pre-existing Deno baseline failure |
| enforcing check cannot see missing authorization | medium | defer | inherent limit of a claim scanner |

## Design Notes

Why a database function: edge functions run in Deno and the apps in Node, and bundling shared TS across both from `packages/` is fragile; one SQL definition guarantees identical decisions. Wrappers stay thin. For payment initiate the capability is evaluated against the payment row: a member must own the row's member, staff must belong to the row's gym with a staff role, and a SaaS-billing row requires the gym's Owner.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` -- expected: all pass
- `pnpm run check:claims` -- expected: exit 0, enforcing
- `bash scripts/ci-local.sh` -- expected: GREEN

### Review Findings

- [x] [Review][Patch] (decided: option 1, add a `deno test` stage to ci-local.sh and fix or quarantine the 3 baseline failures) Edge initiate authorization is not gated by any CI path — `payment-webhook/index.ts` is exempt wholesale in `claim-inventory.exempt.json` and the Deno suite is not in `scripts/ci-local.sh`, so removing `verifyActor`/`authorizeInitiation` from the initiate routes keeps ci-local, pgTAP and Vitest green. Options: (1) add a `deno test` stage and fix or quarantine the three baseline failures; (2) accept and keep the existing deferred-work note. [`scripts/ci-local.sh`, `supabase/functions/payment-webhook/index.ts:95,208`] (medium; blind-hunter+verification-gap+acceptance-auditor)
- [x] [Review][Patch] No test that a 403 `permission_denied` from edge initiate maps to the no-permission outcome — dropping the `code === "permission_denied"` branch in any of these falls to the generic error and no test fails. Add Vitest cases with a `FunctionsHttpError` whose `context.json()` returns `{code:"permission_denied"}`. [`apps/dashboard/services/payments.ts:171,297`, `apps/dashboard/services/billing.ts:224,290-347`, `apps/mobile/src/services/payments.ts:399-411,475-480`] (medium; verification-gap)
- [x] [Review][Patch] Verification counts are stale: `docs/decisions.md` (22.4 entry) says "24 assertions" and the sprint-status `last_updated` comment says "24/24", but `supabase/tests/authorize_action.test.sql` has `plan(26)`. [`docs/decisions.md`, `sprint-status.yaml:1064`] (low; blind-hunter+edge-case-hunter+acceptance-auditor+verification-gap)
- [x] [Review][Defer] `getMemberRegistrationFeeState` is now allowed only for owner/manager/supervisor/receptionist, so a `coach` that previously reached the audit read gets `permission_denied` — deferred: unverified (maybe-false, medium if true). Settle by checking whether coach could open member detail before 22.4 (RLS on members and dashboard role gating). [`apps/dashboard/services/members.detail.ts:106`]
- [x] [Review][Defer] `deleteAuthUserForCleanup` and `deleteMemberForCleanup` are exported service-role writers with no `authorizeAction`, and `check:claims` cannot flag them — deferred: only reached after authorized steps today; a future direct caller would escape. [`apps/dashboard/services/members.provisioning.ts`]

#### Rejected

- Denied initiate leaves a `processing` row (blind-hunter): low; the route deliberately deletes nothing for an unauthorized caller, and the denied actor cannot start a new attempt anyway. Fix would add cleanup branches.
- 403 vs 400 reveals payment-row existence (blind-hunter, edge-case-hunter, acceptance-auditor): low; needs an authenticated caller and a guessed UUID, already rejected in the triage log.
- AC3 older build shows a generic error, not the no-permission text (blind-hunter, acceptance-auditor): real but released builds cannot change; resolving it means editing the spec under review.
- Spec `status: done` vs sprint `review`, `review_loop_iteration: 0` (blind-hunter): fix edits the spec; status is set by this review's step 6.
- Gym for `staff.create` / `member.provision` comes from the claim hint (blind-hunter, edge-case-hunter, acceptance-auditor): false in effect; the database verifies live membership in the passed gym, so a stale hint fails closed.
- Layout redirects to `/auth/login` on a transient RPC error (blind-hunter, edge-case-hunter): low; a retry succeeds and a distinct unavailable state is added complexity.
- `claim-inventory` "live" check is satisfied by name; `onlyServiceRole` scan untested; test files in services walk (blind-hunter, edge-case-hunter, verification-gap): low or false; `check:claims` passes on the real repo, and the scanner's limits are already in deferred-work.
- Layout still calls `getClaims()` (acceptance-auditor): false; it only checks session existence, the `app_role` comparison is gone.
- `unauthorized` error code still used at `admins/actions.ts:148` (blind-hunter): low; that is the step-up failure path, unrelated to live-role denial.
- `search_path = public` without `pg_temp` (blind-hunter): low; the functions are granted to `service_role` only, so no untrusted caller can plant a temp object.
- Rollback ordering, per-request layout cost, `no_session` telemetry noise, duplicated `denied()` and unused `isPermissionDeniedError` (blind-hunter): low or cosmetic; rollback ordering is already in the script's comment.
- Null-gym SaaS payment returns 403, member lookup error downgrades capability (edge-case-hunter): low; both fail closed and no real row hits them.
