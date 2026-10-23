# Epic 23 Context: GymOS Support — Assigned Staff Who Work Inside a Gym

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Super Admin creates GymOS support people by invite and assigns them to gyms many-to-many. Each Owner has one "Allow GymOS Support" switch and sees a single "GymOS Support" row, never an individual. Support configures the gym and handles transactions (payment connection included) within an enumerated allow-list; the gym never learns who they are, and every action is audited under the real individual. Production has real gyms, so support ships denied by default and off for existing gyms until each Owner opts in. Depends on Epic 22 (live authorization, AAL2 gate, session limits, step-up).

## Stories

- Story 23.0: Pre-Flight Checklist (Product Owner)
- Story 23.1: `support` Role, Assignment Record & Live Gate
- Story 23.2: Support Excluded From Counts, Caps, Notifications & Metrics
- Story 23.3: "Allow GymOS Support" Switch & "GymOS Support" Row
- Story 23.4: Create Support Account & Invite
- Story 23.5: Assign, Unassign & Remove
- Story 23.6: Capability Allow-List & Denied-Set Matrix
- Story 23.7: Hidden Identity — Per-Gym Proxy Actor
- Story 23.8: Audit Under the Individual, Disclosure & Member-Facing Surfaces
- Story 23.9: Support Connects the Payment Account
- Story 23.10: Revocation, Owner Visibility & Velocity Lock
- Story 23.11: Lifecycle — Inactivity, Recertification & Factor Reset

## Requirements & Constraints

- Denied by default: no existing policy, function or CHECK lists `support`, so support sees zero rows from every tenant table until the allow-list story opts capabilities in. A catalog test must force every policy/function mentioning `'supervisor'` to be classified as including or excluding support.
- The Owner switch defaults off for existing gyms and on for new ones; turning it off ends all support access on the next request, suspends assignments and removes support memberships atomically; turning it on restores previously active assignments, while assignments made while off stay pending.
- Support is excluded from staff counts, per-role caps, tier limits, operational notifications and metrics through one shared definition; staff-management RPCs refuse to target a support membership from inside a gym.
- Support may do only the enumerated allow-list (gym profile/settings, plans and prices, registration fee, guest charging and loyalty settings, category, staff creation within the ceiling, member records and imports, payments, refunds, fee waivers, payment connection). The denied set (tier, interval, billing anchor, Owner contact, subscription status, suspension, deactivate/delete gym, the allow switch, Owner/Supervisor edits, staff phone change, credential reset) needs one named negative test each. Support cannot create Owner, Supervisor or another support account, or change its own role.
- Money- and access-changing writes (refunds, waivers, staff creation, payment connection) require a valid single-use step-up bound to action and subject.
- A Super Admin cannot hold a support account; support accounts cannot collide with any existing user, Super Admin or linked identity (refusal message must not reveal which matched). One non-ended assignment per person and gym; support holds no other membership in that gym. A request acts on exactly one explicit active gym.
- Support-created staff are tagged `created_by_support`, are not auto-deactivated on revocation, and go to an Owner review queue.
- Identity hiding: no gym-side read (staff list, audit, payment "recorded by", notes, check-ins, exports, Realtime, notifications, error logs) may return a support person's id, name, phone or email; the same person in two gyms must show two unrelated opaque ids. Member-facing surfaces show the gym, never an individual.
- Account creation: inactive until a verified factor; invite is single-use, stored hashed, 24 h expiry, bound to verified phone, no temporary password; unverified email/phone makes the account not assignable. Creation is refused while `super_admin_aal2` is off. Pending assignments become active only by explicit Super Admin confirmation.
- Revocation: in-flight operations complete or roll back; pending items re-owned to the gym proxy; subscriptions/signed links stop within 60 s. Suspended gyms deny support like any staff and do not count toward inactivity.
- Assumption-tagged values to confirm in 23.0 and keep in the single configuration location from 22.7: velocity limits (10/h per gym, 20/h per account, 3 payment changes/day per gym), 60 s cutoff, 30-day inactivity, 30-minute cooling-off, 3-business-day disclosure answer. Deferrable: velocity lock, daily digest, quarterly recertification, inactivity sweep (mark deferred in the story, do not delete).
- (Story 23.10, built in 0144 as `private.support_audit_actions`.) A live support caller writing an audit event with an action type the allow-listed capabilities do not produce is refused with a typed error (`support_audit_action_not_allowed`); reading a real identity writes one audit row.
- Every Super Admin action and invite step writes one `audit_log` row (never links or secrets). Phone/email changes for support go through Super Admin at AAL2 only. Bilingual EN/FR for Owner-facing text.

## Technical Decisions

- New `member_role` value `support` goes in its own migration file, committed before any use. Migrations are numbered at merge time.
- `support_assignments(support_user_id, gym_id, state pending|active|suspended|ended, …)`: RLS on with no client policy (Super Admin reads via function), partial unique index on non-ended rows. `gyms.allow_gymos_support` is written only by the audited Owner-only setter `set_allow_gymos_support` (pin trigger), using `private.current_member_role()`.
- Invariant "active support membership implies active assignment AND switch on" is enforced by a constraint trigger; one `SECURITY DEFINER` function is the only writer. Assignment and the Owner switch are serialized per gym with an advisory lock (test with a concurrent transaction).
- `private.current_member_role()` and `private.gym_id()` return support values only when assignment active, switch on, gym not suspended, account activated/unlocked/no reset pending, session AAL2, session present in `auth.sessions`, and inside the 22.7 limits; else NULL, evaluated live. The claims hook emits `gym_id`/`app_role='support'` only for an active assignment at `aal2`. `switch_active_gym(gym_id)` succeeds only for an active assignment.
- Capability allow-list is data: `support_capabilities(capability, rpc_name | policy_name)`, backed by the catalog test. Staff-target predicates written as `role != 'member'` are rewritten to explicit role lists excluding support.
- Per-gym proxy actor: each gym gets a proxy `users` row (`is_support_proxy`, name "GymOS Support", null phone/email) backed by a banned `auth.users` row; gym creation fails closed if it cannot be created; existing gyms backfilled by a one-time script. `private.actor_id()` returns the proxy for support sessions, else `auth.uid()`; every function writing `auth.uid()` into an actor column must call it (generated `pg_proc`/trigger inventory fails CI on unlisted writers), and `actor_id = auth.uid()` RLS checks become `= private.actor_id()`. `log_audit_event()` writes `actor_display_name = 'GymOS Support'`.
- Real identity lives in `support_action_identity(subject_table, subject_id, real_user_id, gym_id)`, Super Admin read only. The displayed actor is always server-derived.
- Payment connection (AD-37): one audited `SECURITY DEFINER` function validates Tara Money credentials, stores the secret in Vault, derives the masked id server-side, runs the business-id collision guard. No Owner approval step. Replacement retires the old `gym_payment_credentials` row (`retired_at`), unique constraints partial over active rows; payments record `credentials_id` at initiation (backfilled) and webhooks/status/reconciliation verify under it; deleted-credential webhooks get 401 before any write. A `payment_connection_cleanup` job removes retired secrets after no pending/processing payment and 7 days (cap 14). Owner notified immediately; Super Admin alerted; audit never holds credential values.
- Velocity lock: `support_gate_touch()` sets `users.support_locked_at`; the breach is returned as a result so the lock commits (not raised). Crons (`support_activity_digest`, `support_inactivity_sweep`, factor-reset executor) write `job_runs`; the digest uses the existing notification path (AD-25).
- Factor reset: Super Admin at AAL2 with recorded identity check; sessions invalidated; cooling-off freezes phone/email changes and notifies the person (verified phone and email on file), who can cancel (sessions stay revoked, Super Admin alerted); after it, the executor removes the old factor and issues a new single-use invite.

## UX & Interaction Patterns

- Owner staff list shows one fixed, non-editable, non-deactivatable "GymOS Support" row (no individual, no count). Settings shows exactly one state: off ("turned off by you"), on with no one assigned, on with support assigned, on with an assignment awaiting GymOS confirmation, plus time support last acted (EN/FR). Older dashboard builds must ignore the unknown row and still render.
- Super Admin app gets a "GymOS support" section (AAL2) for creating accounts, inviting, assigning, confirming pending assignments, reviewing locks and resets; the individual's name is visible there only. Mandatory reason on assign/unassign/remove/deactivate/unlock.
- Invitee flow: open link, phone one-time code, set password, enroll TOTP; all failures show one generic message.
- Owner can file a disclosure request about a specific audit row; answered outside the product.

## Cross-Story Dependencies

- Epic 22 prerequisites: live helpers and gate (22.3, 22.4), second-factor gate, session limits and step-up (22.7), Super Admin bootstrap and `super_admin_aal2` flag (22.6). Step-up and the limits configuration location come from 22.7.
- 23.0 gates the rest: OQ-30 (suspend, not delete, assignments on opt-out) blocks 23.3; OQ-31 (terms wording, disclosure answer) blocks 23.8; the Owner notice must be sent before release; 23.0 confirmed/deferred decisions govern 23.10 and 23.11.
- 23.1 underpins everything. Chains: 23.1 → 23.2; 23.1 → 23.3 and 23.4 → 23.5 → 23.6 → 23.7 → 23.8; 23.6 + 23.7 → 23.9; 23.7 → 23.10; 23.5 + 22.7 → 23.11.
- 23.6 must wire `private.session_gate_touch` into the dashboard request path for support users: until then no support session can pass the live gate, because `private.support_live` needs a `support_session_state` row and only `session_gate_touch` writes it (23.1). 23.6 (and any later story that lets support in) must use `private.support_gym_id()`: `gym_id()` and `current_member_role()` return NULL for support by owner decision (docs/decisions.md, Story 23.1).
- 23.4, 23.10 and 23.11 are the writers of `private.support_accounts` (activated_at, locked_at, reset_pending_at); nothing writes it before them, so a support user is never live until 23.4 activates the account.
- 23.6 is the story that makes support useful; 23.9 adds the payment connection to its allow-list. 23.7 is the largest (touches every actor-writing function). 23.4 reuses its invite for 23.11's reset. 23.10's digest item on public page contact/about text applies once Epic 24 exists.

## As built (reconciled after the Epic 23 retrospective, 2026-10-22)

Where the build diverged from the wording above by owner decision. The decisions themselves are in the specs and `docs/decisions.md`.

- **No phone for support.** A support person is a `@gymosapps.com` e-mail account. The invite is an e-mail link, then a password, then an authenticator code (23-4; `spec-23-4`). Wherever this file says "verified phone" or "phone one-time code", read e-mail invite plus authenticator.
- **Factor reset notices are e-mail only**, and the cooling-off does not freeze contact changes at the provider. A nightly drift check (`support_contact_drift_check`, 0145) detects a changed address or phone and locks the account, so a change is detected within a day rather than prevented (`spec-23-11`, owner decision 2).
- **Role helpers.** `current_member_role()` and `gym_id()` return NULL for a support person; `private.support_gym_id()` is the only resolver (23-1 triage log). The live gate is `private.support_live` / `support_live_for`, both over one predicate, `private.support_live_core` (0148).
- **Revocation is enforced on every request**, not within a configured number of seconds. The unused `support_revocation_cutoff_seconds` setting was removed (0148); the guarantee is "the next request", and Realtime events re-check the gate.
- **Pending items are not re-owned.** Since 23-7 every support-written row already carries the gym proxy as actor, so revocation flags pending payments instead (`spec-23-10`).
- **Not built:** an Owner "resumed" notice when support is unlocked (named for 23-11, dropped). Open owner decision, see the retrospective.
