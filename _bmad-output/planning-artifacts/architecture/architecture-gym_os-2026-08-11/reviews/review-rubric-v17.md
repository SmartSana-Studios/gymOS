# Rubric review: ARCHITECTURE-SPINE.md, V1.7 Step 1 additions (AD-33..AD-41)

Reviewer lens: good-spine checklist (reviewer-gate.md). Date 2026-10-15.
Inputs: spine; PRD 6.30 (FR-175..FR-195), NFR-023, NFR-026, 10.2 Step 1; addendum H and K.

## Gate verdict

**NEEDS REVISION, do not release for story-writing as is.** The nine new ADs pick the right divergence points and most carry real, enforceable-sounding Rules. But two of the load-bearing promises (default-deny allow-list, one live gate with session limits) are not achievable as written, one new AD conflicts with AD-17 and one with AD-27, FR-193 and FR-194 have no AD, and two K conditions are only partly settled. Counts: 2 critical, 9 high, 11 medium, 6 low.

## Critical

**C1. AD-35: "default-deny allow-list of RPCs" is default-allow for everything that is not an RPC.**
Support is a `supervisor` membership (AD-33), so it passes every existing Supervisor RLS policy, including direct table DML through `supabase-js` (AD-8). The registry and `authorize_support_action` only gate functions that call them. The Prevents line ("denied set drifting as new RPCs ship") is honored for RPCs only. A new table, column or policy added later is reachable by support unless its author remembers to add the AD-33 predicate. That is the opposite of default-deny, and it is exactly the failure FR-179 says the allow-list must prevent. The pgTAP matrix "iterates every RPC and column grant" catches it after the fact, but nothing makes an unregistered policy deny.
Fix options (decide in the spine): (a) give support a distinct role value from `current_member_role()` (for example `support`), so no existing `= 'supervisor'` policy matches by default and each permitted surface opts in; or (b) state that every Supervisor policy gets a support exclusion by default through a shared helper, with a catalog test failing on a policy lacking it. Option (a) is cheaper to enforce but deviates from FR-178's "Supervisor scope" wording, which the PRD should then amend.

**C2. AD-34 / AD-40: the gate cannot do what the Rule says, and the denial list is incomplete.**
- AD-34 puts the whole check inside `private.current_member_role()`, which AD-3 defines as `STABLE`. AD-40 says the gate "touches" `support_session_state` (writes `last_seen_at`). A STABLE function cannot write. The write can only live in `authorize_support_action`, which is called by RPCs and edge functions, not by plain RLS reads and writes. So direct PostgREST traffic never refreshes `last_seen_at`, and the 15-minute idle rule either locks out an active user or cannot be enforced on that path. The 8-hour limit has the same weakness unless `started_at` comes from `auth.sessions` by `session_id`.
- AD-34's null conditions list assignment, opt-out, gym suspension, `aal2` and session limits. It omits what FR-192 explicitly lists: account lock (`users.support_locked_at`, AD-41), account deactivation/removal (FR-185), and factor reset. After a reset (AD-38) a previously issued `aal2` token stays valid until expiry; the live check does not look at the session row or the factor, so AD-34's claim "the live check is what closes the window" is false for reset and lock. Add a live lookup of the `auth.sessions` row by the token's `session_id` claim and of a verified factor.
- AD-40 step-up (`amr` within 5 minutes) for refunds and staff creation: AD-28 itself records that refunds are direct inserts into `refunds`. A direct insert never reaches `authorize_support_action`, so the 5-minute rule does not apply to refunds. Refunds need to move behind a definer RPC, or an RLS policy must evaluate `amr`.
- The `aal` check for Super Admin (AD-38 flag) is not part of AD-34 at all: `private.is_super_admin()` (AD-5) is not `current_member_role()`. See H3.

## High

**H1. AD-39 contradicts FR-186 and leaves a default-open read path.**
FR-186 and addendum H(7) require attribution columns to hold a per-gym opaque identifier, never the platform user id. AD-39 keeps `users.id` FKs and rewrites nothing, resolving K's NF-6 the other way. That is a defensible decision, but the spine does not say it supersedes FR-186, and the PRD must be amended. More important, the protection holds only if no gym-side role can read the raw columns. Gym staff read tables directly (AD-8), and Realtime `postgres_changes` ships raw rows. The Rule says reads "go through views or definer functions" but names no mechanism that forces it: no inventory of every column with an FK to `users`, no column-level revoke, no test that fails when a new attribution column ships without a view. An Owner with two gyms who reads a raw `recorded_by` correlates the person across gyms, which is the stated Prevents. Add a generated inventory of user-FK columns plus a revoke-and-view rule, analogous to AD-34's claim inventory.

**H2. AD-37 vs AD-17 / NFR-002: a DB write before signature verification.**
AD-37 says a webhook arriving after secret deletion "cannot be verified and is recorded in `payment_discrepancies`". AD-17 requires signature verification before any DB write. Also, resolving credentials by `payments.credentials_id` means reading `payments` using an unauthenticated reference before verifying. State the order: look up by reference (read only), verify with the retired credential, then log; and for the unverifiable case either keep the retired verification secret (only the payment credential, not the signing material) or log to a non-state table with rate limiting, and say that this is an explicit exception to AD-17. Also check whether Tara signs webhooks per merchant at all; if the signing secret is platform-wide, credential versioning changes nothing for verification and the AD-37 rationale shrinks.

**H3. AD-38: the Super Admin bootstrap window is the hole it says it prevents.**
Before the flag flips, "a Super Admin may enroll at AAL1". Anyone holding the first Super Admin credential can enroll a factor in that window, exactly "a factor enrolled by whoever holds a first credential" from the Prevents line. The window is open from release until the script runs, and nothing bounds it or makes the support-account feature unavailable until the flag is on (PRD pre-flight requires enrollment first). Also unstated: who may write the platform flag after the flip (it must be service-role-only and pinned, with no path to turn it back off in the app), and how `private.is_super_admin()` enforces `aal2` once on (AD-34 covers only support). "Exactly two verified factors" is not enforced anywhere; Supabase will not enforce a count. Add: creation of any support account refused while the flag is off; a check or alert for factor count; reset of a Super Admin factor (lose one device: sign in with the other, delete, re-enroll within a stated time) written out, because K1 lists "reset of a Super Admin factor" and AD-38 only describes support reset.

**H4. FR-193 is not covered by any AD (K "self-dealing").**
Nothing states: a Super Admin cannot hold or be assigned a support account; creation refuses a phone/email/linked-identity match against Super Admins; a support person cannot act on a record tied to their own phone or email; a member added later who collides with a support phone. AD-33 only refuses an assignment when a `members` row already exists in that gym. Because the membership row exists only while the assignment is `active`, a member can be created in that gym while the assignment is `pending` or `suspended`, and the later activation then collides. Also K asks for "a hard separation of identities" (distinct user ids, not only a phone match). Decide in an AD or defer with a trigger.

**H5. AD-36: Owner verification of the merchant account and "fresh re-authentication" are not settled.**
- K2 asks "how the Owner can verify the merchant account is theirs". AD-36 shows masked identifiers plus the account-holder name "only if the provider returns it [ASSUMPTION]". If the provider does not, nothing is decided. The Owner then sees two masked ids with no way to tell that the proposed one is not an attacker's. The main threat (support points payments at a controlled account) has no fallback control. A decided fallback is needed (for example the Owner provides the id independently and the system compares to it, a confirmation micro-payment, or a Super Admin-only second approval for the first change).
- Re-authentication relies on "the JWT `amr` entry for a one-time-code method within 5 minutes". Owners sign in by phone OTP. Whether a fresh OTP verification produces a new `amr` entry in a refreshed token, and how a client triggers that for an already signed-in user, is unverified and is not in the Deferred spike list (which lists four other items). A Rule that cannot be implemented is not enforceable. Add to the spike list or specify the mechanism (for example a dedicated server-issued OTP challenge recorded against the proposal id).
- First connection is claimed to be treated like replacement (Prevents line), but the Rule never says so, and the existing direct Owner connect path (0052 / FR-126) is not named as retired or routed through the same apply function. If it stays, versioning (AD-37) and the hash flow only cover the support path, and an existing Supervisor/Manager path to credentials may bypass both. Confirm no support-reachable path to the existing connect function remains.
- "Approved" and "applied" are separate states, but nothing says who applies, when, or what happens if apply fails after approval, or that apply re-checks expiry and that the active credential is still the one the Owner saw.

**H6. AD-33/AD-36/AD-37 vs AD-27: new locks outside the "canonical lock order, everywhere".**
AD-27 fixes an order (`class_sessions` -> payment -> member -> ...). AD-33 adds a per-gym advisory lock; AD-36/AD-37 add a per-gym lock that payment initiation "waits on" while it also holds the member lock. Where the per-gym lock sits in the order is not stated. If apply takes the gym lock and then touches payments or member rows while initiation holds the member lock and then waits for the gym lock, that deadlocks on a payment path in production. Place the per-gym lock first in the AD-27 order, or amend AD-27.

**H7. Deferred item "GymOS-mailbox verification" weakens FR-176/FR-190 and diverges two stories.**
FR-176 says an account needs a verified phone and verified email before it can be assigned, and FR-190 notifies on both verified channels. AD-38 makes the email "unverified until mailboxes exist" and the Deferred list defers the check. That is a requirement change presented as a deferral. The assignable-account rule (AD-33 pending) is then ambiguous: one story will require email verification and another will not. Either amend the PRD (phone only until mailboxes exist, notice to one channel) or keep the requirement and drop the deferral. Note also that cooling-off notices to an unverified address may reach no one, so the "second channel" benefit is nil.

**H8. Support-created staff surviving revocation (K "to settle") is only tagged, not decided.**
A support person can create Manager/Receptionist/Coach staff (AD-35) with any phone number and the AD-6 temp-password flow sends them a working login. That is a persistence path that survives assignment removal, outside AAL2 and outside the alias. AD-35 tags them; AD-41 re-owns "pending items" but says nothing about the created accounts. FR-181 requires them to be flagged for review on revocation. Decide: flag only vs. suspend until the Owner confirms; and whether staff creation by support requires the phone to be confirmed by the Owner (not the support person's number).

**H9. AD-34 silently overrides AD-3 on `gym_id`, and FR-194 has no AD.**
AD-3 says `gym_id` "stays claim-derived (the accepted multi-gym-membership resolution)". AD-34's inventory lint fails the build on anything that reads `app_role` or `gym_id` from the claim and "decides from the claim alone". Those cannot both stand. NFR-023 and FR-194 want the active gym re-checked live. State the amendment in AD-3, and say how the gym claim is validated live for support (and for everyone): `private.gym_id()` must still resolve, but the role lookup keyed to (`auth.uid()`, claim gym) is already live, so state that as the mechanism and what the inventory flags. FR-194 (explicit active-gym context for a multi-gym support person, re-checked live, no cross-gym action in one request) is in no Binds. AD-4 (`switch_active_gym()`, `list_own_active_gym_memberships()`) must be amended so support switching validates the assignment, and so the self-read exception exists given AD-39 hides support `members` rows from every non-Super-Admin (see M3).

## Medium

**M1. AD-33 and FR-177: Super Admin confirmation of activation.** FR-177 says a pending assignment activates only when a Super Admin confirms it after enrollment is complete and the switch is on. AD-33 reads as automatic activation. Mandatory reason and AAL2 on assign/unassign (FR-177, FR-185) are also not placed in any AD.

**M2. AD-33: "membership row exists only while the assignment is `active`" conflicts with the soft-delete convention and with FKs.** Suspend/resume (FR-183) would delete and recreate the `members` row, orphaning `member_id` references (notes, check-ins, staff tags). Use `deactivated_at` on the same row, or state the delete and what happens to FKs. The transitions `active <-> suspended` on Owner switch off/on are also not written (only the state names are listed).

**M3. AD-39 hides support `members`/`users` rows from "every non-Super-Admin", including the support person.** The gym switcher (AD-4) and the person's own profile need a self-read exception, and it must still not expose the row to the gym.

**M4. FR-182 (Owner-visible row and four states, "time support last acted") has no read contract.** AD-33 and AD-39 list FR-182 in Binds but no Rule defines the one function or view that returns the single fixed row, the state, or the last-acted time, or that it never leaks a count or the assignment timing. PRD also still has three vs four states (K "small text contradictions").

**M5. AD-34 / AD-3: the grep gate does not exist, and the grandfather list conflicts with NFR-023.** AD-3 records the gate as not built, with 52 grandfathered files. AD-34 says "extended". It is a build, and Step 1 gate item 8 says the inventory must be empty of claim-only decisions, which contradicts a grandfather list. Also "decides from the claim alone" is not mechanically decidable; define it as any reference to `auth.jwt()`/`request.jwt.claims` in a catalog definition outside a named allow-list. The inventory is of live catalog objects (`pg_policies`, `pg_proc`), not migration files, and that should be stated.

**M6. AD-34 / FR-184: 60-second end of live subscriptions and signed links.** Revoking sessions does not close an existing Realtime socket or an issued signed URL; the AD itself notes the access token stays valid until expiry. No AD maps FR-184's 60 s to a mechanism (rejoin-time re-authorization, short-TTL signed URLs for support, forced channel close).

**M7. NFR-023 "payment inserts verify that the member belongs to the gym" is in no AD.** Include it in AD-34's Rule or the payment-policy retrofit scope (Step 1 gate item 8 names the payment policies).

**M8. AD-38: reset cooling-off has no executor, and changes to the phone/email during it are not frozen.** Who runs the delayed `deleteFactor` after 30 minutes (no job in AD-41)? K (NF-3) says phone/email changes bypass the cooling-off; AD-38 does not freeze them during an open reset and invite. Also the invite is "bound to the verified phone": if the phone can change before redemption, the binding is moot.

**M9. AD-40 only covers support sessions; K NF-4 asks for Super Admin session timeout and step-up.** Super Admin creates, assigns and resets support accounts. Decide it or defer it with a trigger. AD-5's wording "Super Admin reads base tables and sees the individual" (AD-39) should be scoped to support-identity tables and audit views, since AD-5 forbids a blanket gym-data bypass outside the escalation flow.

**M10. AD-36 / AD-25: "Owner is notified immediately" has no delivery channel.** AD-25 is Expo push from the DB; the Owner may not have the member app installed and uses the dashboard. FR-180's whole control is that the Owner is told. Name the channel set (in-app banner, WhatsApp via AD-12, push) and what happens if none is delivered; otherwise a proposal can sit unseen for 24 h.

**M11. Operational envelope: three new security-relevant cron jobs (AD-41) and a one-time script (AD-38) land with job-failure alerting "not yet built".** A silent failure of `payment_connection_cleanup` leaves Vault secrets undeleted; of `support_inactivity_sweep` leaves dormant support accounts enabled. The new HMAC `server_secret` (AD-39) has no location or owner recorded in the Deployment paragraph, and rotation is deferred. Also not mentioned: where the Auth Admin API calls run when the trigger is the Owner's switch or a cron job (Postgres cannot call them, per AD-6; cron can only delete `auth.sessions` rows).

## Low

**L1. FR-195 is in AD-39's Binds but the Rule only covers gym-side reads;** receipts, member-app and message templates are not addressed.

**L2. AD-41 job split:** AD-36 and AD-41 combine proposal expiry, secret deletion and retired-credential deletion in one `payment_connection_cleanup` job while AD-41's own Prevents says one job per concern.

**L3. AD-41 velocity** includes "assignments", but assignments are Super Admin actions, not support actions checked in `authorize_support_action`.

**L4. AD-37 retention numbers (7 days, hard cap 14)** have no rationale; the in-flight window is bounded by the 10-minute stale helper (AD-27) and a late webhook by the provider's retry window. Give the reason or a config row.

**L5. AD-14 still says credentials are selected by `{type:'gym', gym_id}`;** AD-37 changes resolution to `credentials_id`. State the amendment in AD-14 (the platform context is unchanged).

**L6. ERD omissions:** `support_session_state`, `support_capabilities`, `support_action_log`, `support_disclosure_requests` and `users` support flags are not shown. Also "binds" and `sources` of the header list NFR-026 while the body defers it.

## Rationale bloat and story-level detail

- Column lists in AD-33, AD-36, AD-40, AD-41 (`support_assignments(...)`, `payment_connection_proposals(...)`, `support_session_state(...)`, `users.support_locked_at`) are schema detail that belongs in the story; the spine needs only the invariants (source of truth, immutability, one open per gym, hash content). The hash field list in AD-36 is justified by K2.
- AD-40/AD-41 restate FR-189/FR-181 numbers (8 h, 15 min, 5 min, 10/20/3 per hour) that are PRD `[ASSUMPTION]`s. Two copies will drift; reference the FR or a config row.
- AD-38's last-resort runbook and AD-34's provider-behavior parentheticals ("checked 2026-10-15") are fine as evidence but belong in `docs/decisions.md`; the spine should keep the decision only.
- The new Conventions row "Support-reachable functions" duplicates AD-34/AD-35 but is useful as the one-line check; keep, but it inherits C1 (it speaks only of functions).

## Coverage

FR-175 partial (collision refusal not in an AD; account creation owner is AD-38 only for activation). FR-176 partial (H7). FR-177 partial (M1). FR-178 AD-33/35 (collision-in-reverse, H4). FR-179 AD-35 (C1). FR-180 AD-36/37 (H5). FR-181 AD-41 (L3, H8). FR-182 partial (M4). FR-183 AD-33 (M2). FR-184 partial (M6, H8). FR-185 AD-41/38 (phone/email change via Super Admin AAL2 not stated). FR-186 AD-39 (contradicts, H1). FR-187 AD-39. FR-188 AD-33. FR-189 AD-34/40 (C2). FR-190 AD-38 (M8). FR-191 AD-38 (H3; last-resort not app-audited, deviates from "itself audited" by design). FR-192 AD-34 (C2). **FR-193 not covered (H4). FR-194 not covered (H9).** FR-195 Binds only (L1). NFR-023 AD-34 except the payment-insert gym check (M7). NFR-026 explicitly deferred to the Step 2 spine pass (acceptable; the `__Host-` spike item is listed).

K conditions: (1) Super Admin recovery/bootstrap: partly settled (second factor as recovery, flag, last resort), gaps H3, M8, M9. (2) FR-180 proposal/hash contract: hash content, reject, expiry, secret cleanup settled; Owner re-auth mechanism and merchant verification fallback not (H5). (3) Payment cutover: settled in AD-37 for in-flight and late webhooks, but conflicts with AD-17 (H2) and AD-27 lock order (H6).
Other K "to settle" items: self-dealing H4; support-created staff H8; NF-4 M9; NF-3 M8; NF-6 resolved by AD-39 (H1 caveat); `__Host-` spike listed; `log_audit_event` lockdown not placed in the Step 1 gate (only mentioned inside AD-3; add to AD-34 or Step 1 gate); NF-5 name squatting (Step 2, deferred); NF-8 suspension vs auto-disable resolved in AD-41.

## What is good

AD-33's single source of truth plus single predicate, AD-32-shaped setter with its own pin trigger, AD-36's immutability and hash binding, AD-37's version-by-id design, AD-38's honest handling of the missing recovery codes, and explicit [ASSUMPTION] and spike markers are all real divergence-fixing decisions. The `private.current_member_role()` live-check reuse (AD-3) is consistent with the inherited AD-1..AD-6 direction; the only direct conflicts with AD-1..AD-32 are H2 (AD-17), H6 (AD-27), H9 (AD-3), and the weak points L5 (AD-14), M9 (AD-5).
