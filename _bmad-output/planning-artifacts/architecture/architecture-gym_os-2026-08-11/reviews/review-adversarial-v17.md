# Adversarial review: V1.7 Step 1, AD-33..AD-41

Reviewed 2026-10-15 against ARCHITECTURE-SPINE.md (AD-1..AD-32 for context) and migrations 0007, 0018, 0052, 0054, 0061, 0063, 0065, 0070, 0076.

**Verdict: with fixes.** The shape is right (one assignment record, one gate, allow-list, proposal flow, versioned credentials). But three of the load-bearing sentences are not true of the code as it stands, so stories cut today would each satisfy their AD and still leave holes: "default-deny" is not default-deny, the alias does not hide the actor, and the live check does not cover the paths that decide from the claim. Fix C1-C6 before cutting stories; the rest can be folded into story ACs if the AD text is amended.

Counts: critical 6, high 9, medium 9, low 3.

---

## CRITICAL

### C1. Support is a `supervisor`, so every existing RPC and policy that already admits a supervisor admits support. The allow-list only protects code that calls `authorize_support_action`.

Pair: Story A ships `set_loyalty_rules()` exactly like `set_registration_fee()` (AD-32: checks `private.current_member_role() in ('owner','supervisor')`, audits, pin trigger). Story B is the support allow-list. Both obey their AD. A support session calls `set_loyalty_rules` (or `create_staff_member`, `update_staff_role`, `deactivate_staff`, `set_registration_fee`) and passes, because AD-34 makes `current_member_role()` return `'supervisor'` for an authorized support member. The claim in AD-35 "adding an RPC without registering it denies it for support by default" is only true if the RPC calls the gate. Nothing forces that; the lint covers only "service-role code" and "functions a support session may reach", which is circular.

The same applies to tables: many tenant tables have direct INSERT/UPDATE policies for supervisor/manager (AD-8, supabase-js direct). AD-35 is default-deny for RPCs but default-allow for policies ("policies on denied surfaces exclude support"). A new table or policy written by a story that never heard of support is open to support writes through PostgREST, with no RPC involved.

**Fix (AD-34 + AD-35):** invert it. `private.current_member_role()` returns NULL for any `is_support` member, always. Registered capabilities use a separate helper `private.support_capability_role(capability)` that the RPC calls explicitly and that returns `'supervisor'` only if the registry lists that RPC and the live conditions hold. Everything unregistered then fails closed with no author action. For tables, state that direct write policies must be `with check (not private.is_support_member())` by default, via a CI inventory over `pg_policies` (not just a grep of migrations) that fails if a write policy lacks the predicate and is not on an explicit allow-list of support-writable tables.

### C2. The alias hides nothing: the real support `users.id` and display name are stored in gym-readable base tables and in `audit_log`.

AD-39 says "storage keeps its `users.id` FKs, gym-side reads go through views". But gym staff read base tables directly by PostgREST under RLS (AD-8). Every actor column (`recorded_by`, `created_by`, `performed_by`, `connected_by`, check-in staff, notes, refunds) holds the raw support `users.id`. That UUID is identical across gyms, so it is exactly the cross-gym correlator FR-182 forbids; a view over a different surface does not remove it from the base table the Owner can also select from. Worse, `log_audit_event()` (0063) denormalises the real name at write time into `audit_log.actor_display_name` and stores `actor_id`; "derived in the view" cannot undo a stored column. Realtime `postgres_changes` sends the whole row (RLS-filtered rows, not column-filtered), so the UUID also streams. PostgREST embeds (`users(*)`) return null for the unreadable user but the FK column still carries the id.

**Fix (AD-39):** pick the write-time model, not the read-time one. When the caller is a support member, every attribution write stores a per-gym proxy actor id (a `users`-FK-compatible `support_actor_proxies(gym_id, support_user_id, proxy_user_id)` row, mapping readable by Super Admin only) and `log_audit_event` writes "GymOS Support" as `actor_display_name` and the proxy as `actor_id`. The real mapping lives in `support_action_log`. The HMAC alias is then unnecessary or is the proxy id derivation. Add to the Step 1 gate a pgTAP test that scans every column that FKs to `users` and asserts no gym-readable row contains a real support id.

### C3. Policies and functions that decide from the JWT claim alone give support AAL1 access and post-revocation access; AD-34's "live check closes the window" does not cover them.

Existing tenant policies are `gym_id = private.gym_id()` (plain STABLE, reads only the claim) plus `app_role` from the claim; 52 migration files are grandfathered (AD-3 status note). The hook (0065) hands any user with an active `members` row `gym_id` and `app_role = supervisor`, without looking at `aal`. So:
(a) A support session that has only passed the phone OTP (aal1) holds a token with `app_role='supervisor'` and reads/writes everything the grandfathered policies allow. AD-34's aal2 check lives only in `current_member_role()`, which those policies do not call.
(b) After revocation or Owner opt-out the members row goes away, but the access token (up to 1 h) still carries `gym_id`; claim-only policies keep passing. AD-34 says correctness "never depends" on session deletion, but for every claim-only policy it does.

AD-34's "generated inventory fails the build if any decides from the claim alone" is a build gate on a list that currently has 52 grandfathered entries; it cannot be green without migrating them, and the AD does not say that is in scope.

**Fix (AD-34 + AD-2/AD-4 hook):** make the fail-closed move at the two choke points instead of per policy. (1) The claims hook, for `users.is_support`, emits `gym_id`/`app_role` only when the event's `aal` is `aal2` and the assignment is active, and adds an `is_support` claim. (2) `private.gym_id()` returns NULL when `is_support` is set and the live assignment/setting/lock check fails (one extra lookup only for support tokens). This covers grandfathered policies without touching them. State that the grandfather list is closed for support: any grandfathered site that reads `app_role` for a write must be migrated or listed with a reason.

### C4. The hash does not bind the secret contents; the proposer can swap credentials after the Owner approves.

AD-36 hashes proposal id, gym, provider, secret id, merchant fingerprint, expiry. The Vault secret is created by a service-role function at proposal time, and "credentials are immutable on the row" only constrains the proposal table. `vault.update_secret(secret_id, …)` is a service-role operation the same edge function can call between approval and apply: the Owner approves "•••• 1234", the apply function reads the secret at that id, which now holds a different merchant's apiKey/businessId/webhookSecret. "Merchant fingerprint" is undefined; if it is computed at proposal time from the same secret it is not re-checked at apply.

**Fix (AD-36):** at proposal time store `secret_digest = sha256(canonical(apiKey, businessId, webhookSecret))` and define the fingerprint as a digest of businessId. The apply function decrypts the secret inside the definer function and refuses unless the digest and `business_id_plain` match the approved hash, in the same transaction as the credential write. Also: the secret is created once and apply may not run unless `state = 'approved'` and `now() < expires_at`.

### C5. Two owners of the credentials entity: 0052's direct connect/disconnect are in-place and destructive; AD-36/37 assume versioned apply.

`connect_gym_payment_credentials` (0052/0054) still exists, is Owner-callable, and does `vault.update_secret(existing)` plus an in-place `update` of the active row. `disconnect_gym_payment_credentials` deletes the row and the Vault secret. AD-37 says a payment resolves "the credentials it started under" by `payments.credentials_id` and that retired secrets live until payments settle. Under the first function, a pending payment's credential changes underneath it (webhookSecret rotated: its webhook no longer verifies, or the row id is the same but the account differs). Under the second, `payments.credentials_id` dangles (FK violation, or silently nulls) and the secret is gone while a payment is pending. Neither AD names these functions. Story "Owner connects" and story "apply proposal" both obey their AD and fight.

Further structural clashes with the existing rows:
- `idx_gym_payment_credentials_provider_business_id` (0054) is a full unique index on `(provider_key, business_id_plain)`. A retired row keeps its `business_id_plain`; an Owner rolling back to the previous merchant (a normal recovery) violates it. If relaxed to partial-on-active, two rows (retired and active) can share a business id with different webhook secrets and the webhook's businessId lookup becomes ambiguous.
- `get_gym_payment_connection_status` is declared `returns table` and "zero rows = not connected"; with retired rows it returns multiple rows unless filtered.
- reconciliation `wrong_account_settlement` (0070, 0076) compares `p.created_at >= g.connected_at` against the gym's credentials row. Once there are several rows per gym, payments legitimately settled to the retired account after apply are flagged as wrong-account unless the check moves to `payments.credentials_id`.

**Fix (AD-37):** add an explicit migration clause: `connect_gym_payment_credentials` becomes "create a new version and retire the old" (the same apply core as AD-36), `disconnect` retires and never deletes while payments are open, `get_gym_payment_connection_status` filters `retired_at is null`, the business-id unique index is redefined (active-only) with webhook resolution defined as "match payment by ref, else businessId among active then retired rows, verify against that row's secret", and reconciliation uses the payment's credential row. State that exactly one function body writes `gym_payment_credentials` and both the Owner path and the proposal path call it.

### C6. A webhook cannot resolve credentials "by `payments.credentials_id`" when it arrives before the payment row is linked.

0054 deliberately resolves `gym_id` from the payload's `businessId` (accepted 2026-08-01 webhook-before-ref-persisted race, noted in its header). AD-37 says webhook verification resolves "by that id, never by current". In the race the payments row cannot yet be matched, so there is no id to resolve by; implementers must either break the accepted race handling or fall back to "current", the exact thing AD-37 forbids. Also `payments.credentials_id` does not exist: every payment pending at deploy has NULL, and AD-37 gives no rule for them (the only correct one is "the single row for that gym at migration time", which must be a backfill step).

**Fix (AD-37):** write the two-step resolution (by payment id when linked; else by payload businessId against all rows including retired) and the NULL backfill rule, and require `credentials_id` to be set inside the same transaction that creates the pending payment, before the provider call.

---

## HIGH

### H1. Lock identity is unspecified, and the existing locks already differ.
AD-33 and AD-36/37 each say "the per-gym lock". Existing code has two incompatible keys: `hashtext(gym_id::text)` in `enforce_member_cap` (0018) and `hashtextextended(gym_id||':'||provider_key,0)` in connect (0052). Story A uses the first for the support membership writer, story B the second for apply: apply and the `allow_gymos_support` setter then do not exclude each other, and the member-cap trigger (fired by any `members` insert, including the support membership insert) takes the first key inside the second, giving a lock-order inversion. If the "per-gym lock" is the cap key, payment initiation waiting on it (AD-37) stalls every member insert for the gym.
**Fix (AD-33):** define exactly one lock, `private.gym_support_lock(gym_id)` = `pg_advisory_xact_lock(<namespace constant>, hashtext(gym_id))`, a fixed acquisition order (support lock, then credentials, then cap), and use a different key from the cap trigger so initiation never blocks member creation.

### H2. `authorize_support_action(gym_id, capability)` has no actor and no claims.
A service-role edge function has no `auth.uid()`, no `auth.jwt()`, no `aal`, no `amr`. The signature in AD-34 takes only gym and capability. Either the function reads the actor from a caller-supplied parameter (then a buggy or compromised function lies), or the edge function re-verifies the JWT and passes `aal/amr/session_id` as arguments (trusting its own parsing). Also pg_cron/trigger paths have no actor at all.
**Fix (AD-34):** the signature is `(p_user_id, p_session_id, p_gym_id, p_capability)`; the edge function passes only values from a JWT it verified via `auth.getUser(token)`; aal/amr come from the verified payload, never request body; cron/trigger paths are declared "system actor" and may not carry a support capability.

### H3. The gate cannot do what AD-34/40/41 ask of it: `current_member_role()` is STABLE, and a denial rolls back its own side effects.
- 0061 declares it `stable security definer`. AD-40 wants the gate to touch `support_session_state` and AD-41 to append `support_action_log` and set `users.support_locked_at`. Writes inside a STABLE function raise; calling a VOLATILE function from RLS runs per row.
- Even in a volatile gate, "deny" is an `raise exception`, which rolls back the same transaction's `support_locked_at` update and log row. Velocity-lock and denied-attempt evidence never persist, and a rate limit that counts only successes never trips on probing.
**Fix (AD-34/40/41):** split into a STABLE reader (`current_member_role()`, no writes) and a VOLATILE `authorize_support_action` that logs attempts through an autonomous path (dblink/`pg_background`, or a second call from the edge function after the failed RPC) so denials persist. State where `support_locked_at` is written when the call raises. Session touch happens only in the volatile gate, never in the reader.

### H4. AD-34's live condition list is incomplete.
It lists assignment active, setting, gym not suspended, aal2, session limits. It omits `users.support_locked_at` (AD-41), account `activated` (AD-38), assignment `suspended` due to recertification, and the Super Admin's own suspension of the person. A locked account passes every path that reads only `current_member_role()`, because velocity lock is set in a different function that nothing consults.
**Fix (AD-34):** one `private.support_access_live(user_id, gym_id)` helper is the single definition and is what both the reader and the gate call; enumerate its conditions in the AD.

### H5. State machine for `pending/active/suspended/ended` is two events with no transition table.
"Pending until account activated and while the setting is off" means the Owner toggling the setting back on reactivates assignments automatically, including ones Super Admin suspended or velocity-locked (the toggle writes state). Activation of one account (a per-user event) must activate pending assignments across many gyms: it takes N gym locks in unspecified order, deadlocking against two concurrent toggles. Also `ended` followed by a new assignment for the same pair needs a uniqueness rule (one non-ended row per `(user, gym)`).
**Fix (AD-33):** add the transition table; the Owner setter may only move `active -> pending` and `pending(setting_off) -> active` on assignments flagged `held_by_setting`; `suspended` is never touched by it; activation locks gyms in sorted id order; partial unique index on `(support_user_id, gym_id)` where `state <> 'ended'`.

### H6. Multi-gym support users: silent fallback and tab race land actions in the wrong gym.
0065's hook honors `active_gym_id` if still valid, else most-recent membership. A support person with several gyms whose active gym's assignment ended silently gets another gym on the next refresh. `active_gym_id` is a user-level column, the claim is token-level: switching in tab 2 and refreshing in tab 1 moves tab 1 to the new gym mid-form (refunds, proposals, staff creation).
**Fix (AD-4/AD-34):** for `is_support`, the hook emits no `gym_id` when `active_gym_id` is NULL or invalid (no most-recent fallback) and the UI must pick; every support mutation RPC takes an explicit `p_gym_id` and refuses if it differs from the claim; the gym name is shown in the confirmation.

### H7. Super Admin pre-flip window and where AAL2 is enforced.
AD-38 lets a Super Admin act at AAL1 until the flag flips; in that window they can create support accounts, assign them, and reset factors. Nothing says the flag is unreachable from the app (service-role or `users` update by the Super Admin themself), nor where "Super Admin requires AAL2" is enforced: `is_super_admin_live()` and the hook's `super_admin` claim have no aal check today.
**Fix (AD-38):** until the flip, the platform cannot create support accounts or assignments at all (feature-gated on the flag); the flag lives in a table with no policy, written only by the script; the hook and `is_super_admin_live()` return false at aal1 after the flip.

### H8. AD-41 "re-owned to a system actor" rewrites FKs that AD-39 says are never rewritten.
Re-owning pending items changes `created_by`-style columns, needs a system `users` row and an audit entry, and conflicts with "no column rewritten". It also leaks timing (the Owner sees which items flipped when).
**Fix (AD-39/41):** with C2's proxy actor the pending items already carry a gym-scoped proxy; revocation marks the proxy `retired` and the items need no rewrite. State what "pending items" means (list of tables) so the story can implement it.

### H9. Approval, apply and who triggers apply.
States go `approved -> applied`, but the AD does not say who calls apply or when. If support calls it, the Owner may have switched `allow_gymos_support` off after approving: the apply must re-check the gate. If a job calls it, there is a window where an approved-but-unapplied proposal can be applied after expiry. `decided_by <> proposed_by` is not enforced. AD-36 requires "the JWT `amr` one-time-code entry within 5 minutes", but Supabase has no "reauthenticate for step-up" call that adds an amr entry without issuing a new session; the only path is `verifyOtp`, which replaces the session (mobile and dashboard clients must be told).
**Fix (AD-36/40):** apply is run by the approval transaction itself (single step, no `approved` limbo) or re-checks gate, expiry and digest; `decided_by` must be a current Owner and `<> proposed_by`; document the step-up call and that it rotates the session; verify the amr method name in the spike.

---

## MEDIUM

1. **Last-4 masking is insufficient for a confirmation that defends against a hostile proposer.** Support can choose a merchant id with the same last four digits. Show the full id on the confirmation (it is not a secret; 0054 stores it in plain) or at least the first 4 and last 4, plus the provider-returned name when available. AD-36.
2. **Support is not time-boxed by the DB but `members` row deletion semantic is unclear.** "The members row exists only while active": delete or `deactivated_at`? Deleting breaks FKs from audit and staff tables and loses the 9.6 hook's `deactivated_at is null` contract; soft delete matches the soft-delete convention but then the unique `(user_id, gym_id)` blocks re-assignment. State it (AD-33).
3. **FR-091 guard is one-directional.** Assignment is refused when a members row exists; nothing stops `create_staff_member(p_user_id)` or Super Admin gym/owner creation from adding a non-support row for a user with an active support row. Add a trigger on `members` (AD-33).
4. **Idle limit counted from gate touches only.** AD-40 touches `last_seen_at` in the gate, but reads go through policies (no gate), so an active reading session is "idle" at 15 min and is cut off, while a script calling one registered RPC every 14 minutes never idles. State what counts as activity and where the touch happens (AD-40).
5. **Alias secret custody and rotation.** `HMAC(server_secret, gym_id||user_id)` inside a definer function needs the secret in Vault or a GUC; rotating it changes every `created_by_support` tag. State where it lives and that it is write-once (AD-39). If C2's proxy approach is adopted this goes away.
6. **Proposal creation skips the collision guard.** 0083 guards platform business-id collision at connect time; AD-36 creates the Vault secret and proposal without it, so a collision is discovered at apply after the Owner has approved. Run the same guards at proposal (AD-36).
7. **Retention cap vs pending payments.** AD-37 deletes the secret after 14 days even if payments are still pending; a late webhook is a discrepancy, but the member has been charged on the old merchant. Define the member-visible outcome and who is told (AD-37).
8. **Revocation via `auth.sessions` delete is unverified.** Listed in the spike list; but AD-34 and AD-38 both rely on it for "signs the person out everywhere". Until verified, AD-38's reset says nothing about what happens to a still-valid access token in the 30-minute window or for the hour after (covered by C3's fix).
9. **Super Admin sees individuals in base tables (AD-39) but the same Super Admin account is a gym-support impersonator risk?** Super Admin is not a support member, but may act through the AD-5 escalation; the escalated session's attribution is the individual Super Admin id (their own FR-072 audit), which then lands in the same gym-readable actor columns as C2. Specify that Super Admin escalation writes use the same proxy actor rule.

## LOW

1. `list_own_active_gym_memberships()` (0074) and the 0065 "read gyms of own active memberships" policy return gym names for support's active gyms only; correct, but also exposes `gyms` columns the allow-list (AD-35) says are denied (tier, Owner contact) if the policy is a whole-row select. Restrict by column grant for support.
2. Phone-uniqueness errors from `auth.admin.createUser` tell the Owner a phone number is registered; negligible unless the support person's phone is known, but it confirms identity. Return a generic error (AD-6).
3. The AD-38 runbook step "recorded by hand" has no owner or location; name the file/table and the review cadence (AD-38).

---

## Feasibility notes (checked against code)

| Question | Answer |
| --- | --- |
| Does AD-3's `current_member_role()` have the signature AD-34 assumes? | Mostly. It is `private.current_member_role() returns member_role`, no args, `stable security definer`, scoped by `auth.uid()` and the claim `gym_id`, selects `deactivated_at is null` ordered by `created_at desc`. Returning NULL is safe for existing callers (all use `if/else` that falls to "not authorized"). It cannot write (H3) and does not know about support (C1). |
| Can a SECURITY DEFINER function read `aal`? | Yes: `auth.jwt()` reads the `request.jwt.claims` GUC, which definer functions inherit, so `auth.jwt() ->> 'aal'` and `amr` work. Not available in service-role or cron paths (H2). |
| Does the claims hook let a support user with several gyms choose safely (AD-4)? | No. `switch_active_gym` validates only that a members row exists; the hook falls back silently and has no `aal`/support notion (C3, H6). The hook event does carry `aal` in claims, so the fix is feasible there. |
| Does retiring a credential interact with 0052? | Yes, destructively (C5): in-place update, row+secret delete, full unique index, single-row status function, `connected_at` anchor in reconciliation. |
| Cap trigger | `enforce_member_cap` counts `role='member'` only, so a support `supervisor` row is not counted; AD-26's own text ("active+deactivated") and AD-33's predicate are consistent only if the story does not add `is_support` to the count. Fine, but note that the trigger fires on the support membership insert and takes `hashtext(gym_id)` (H1). |
| `log_audit_event()` | Stores `actor_id` and denormalised `actor_display_name` (C2). Still reads the claim for `private.gym_id()` and `is_super_admin_live()`. |
