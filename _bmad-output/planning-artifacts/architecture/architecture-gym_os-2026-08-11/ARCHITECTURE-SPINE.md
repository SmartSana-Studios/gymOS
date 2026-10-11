---
name: 'gym_os'
type: architecture-spine
purpose: build-substrate
altitude: feature
paradigm: 'RLS-as-authorization-boundary + thin per-domain service layer, with Hexagonal ports/adapters at swappable external-integration seams only'
scope: 'gym_os platform architecture — V1.0 (shipped, Epics 1–8) + V1.5 Beta-Ready (Epics 9–13, Epic 4/6 extensions, registration fee) + V1.6 (per-visit paid sessions, loyalty, gym category). Governs every epic; supersedes the pre-spine architecture.md (2026-07-04).'
status: final
created: '2026-08-11'
updated: '2026-10-11'
binds: ['epic-1', 'epic-2', 'epic-3', 'epic-4', 'epic-5', 'epic-6', 'epic-7', 'epic-8', 'epic-9', 'epic-10', 'epic-11', 'epic-12', 'epic-13', 'v1.6']
sources:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md (v1.6)
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-11.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-08.md
  - _bmad-output/planning-artifacts/architecture.md (prior version, superseded by this spine)
  - docs/decisions.md
companions: []
---

# Architecture Spine — gym_os

## Design Paradigm

Supabase-native: Postgres RLS is the *only* tenancy/authorization boundary — there is no app-side API gateway or repository layer re-implementing it. Three Next.js/Expo apps (dashboard, super-admin, mobile) talk to Postgres directly via `supabase-js`, through a thin per-domain service layer that performs no authorization logic of its own. The two points that genuinely need swappable external vendors (payments, messaging) are isolated behind Hexagonal ports (`PaymentProvider`, `OtpDeliveryProvider`, `WhatsAppMessageProvider`) — everywhere else, the pattern is deliberately *not* applied, since RLS already owns the one boundary that matters.

## Invariants & Rules

### AD-1 — RLS is the sole tenancy/authorization layer [ADOPTED]

- **Binds:** all
- **Prevents:** a second, driftable copy of tenancy/role logic in application code (repository pattern, app-side gateway)
- **Rule:** every table enables RLS with a deny-all default in the same migration as its `CREATE TABLE`. A `STABLE` helper (`private.gym_id()`) is reused across all tenancy checks. Explicit per-action (SELECT/INSERT/UPDATE/DELETE) policies per table, never `FOR ALL`.

### AD-2 — JWT custom-claims hook, canary-tested [ADOPTED]

- **Binds:** all auth
- **Prevents:** the hook's failure mode (silent deny-all) going undetected
- **Rule:** the claims hook is a `SECURITY DEFINER` Postgres function (`custom_access_token_hook`), never an HTTP Edge Function. A CI canary test asserts a known test tenant sees a non-zero, correctly-scoped row count on every run.

### AD-3 — Role/status authorization reads live state, not the JWT claim

- **Binds:** every RLS policy *and every `SECURITY DEFINER` function* that gates on role or gym status (existing and future) — not RLS policies alone; Epic 9 (FR-089/FR-090), Epic 11 (NFR-018, suspended-gym denial)
- **Prevents:** a demoted-but-not-logged-out staff member, or a member of a just-suspended gym, retaining stale access — the window "next token refresh" leaves open. Also prevents the specific regression AD-6 would otherwise inherit: `log_audit_event()` (`0007_audit_log.sql:191`) currently reads `auth.jwt() ->> 'app_role'` directly inside a `SECURITY DEFINER` body, exactly the pattern this AD retires — any new `SECURITY DEFINER` function (`create_staff_member()`, `update_staff_role()` per AD-6) must call the new helper, not copy that existing call site.
- **Rule:** a new `STABLE` helper, `private.current_member_role()`, performs a live lookup against `members` (scoped by `auth.uid()` + `private.gym_id()`); a second helper, `private.current_gym_status()`, does the same against `gyms.status`. Both are called on every RLS evaluation and from inside every `SECURITY DEFINER` function that currently branches on `auth.jwt() ->> 'app_role'` — including the pre-existing `log_audit_event()`, which this AD requires updating, not just new code. Role/deactivation/gym-suspension changes take effect on the very next query, no refresh required. `gym_id` itself stays claim-derived (the accepted multi-gym-membership resolution below is unaffected). A CI grep-lint gate forbids new `auth.jwt() ->> 'app_role'` call sites in `supabase/migrations/`, mirroring the existing i18n hardcoded-string lint gate's shape (fails the PR, not just a review-checklist item) — **Status (2026-10-11, verified):** the gate is specified but **not built** — no CI step greps for it, and 52 migration files now carry the call, including new sites in 0098–0102 added after this AD was written. Building the gate (with an explicit grandfather list of the 52 files) is a prerequisite for the V1.6 migrations, not a follow-up; AD-27, AD-29, AD-30 and AD-32 all depend on the live-role helper and have no other mechanical guard.

### AD-4 — Multi-gym membership resolution: explicit preference, most-recent fallback [ADOPTED, amended 2026-10-11]

- **Binds:** the claims hook, the gym switcher, any suspended-gym screen
- **Prevents:** undefined behavior when one user holds `members` rows at more than one gym; a switcher that trusts a client-supplied gym id
- **Rule:** the claims hook honors `users.active_gym_id` when it names a non-deactivated binding of that user, else falls back to the most-recently-created non-deactivated `members` row. `active_gym_id` is written only by the validated `switch_active_gym()` RPC (Story 9.6, 0065). The list of a user's gyms comes from `list_own_active_gym_memberships()` (0074), the one read allowed to cross the current gym's suspension gate. Loyalty, sessions, and registration-fee state are per member row, hence per gym — never joined across a user's gyms.

### AD-5 — Super Admin escalation is explicit and audit-logged, never a blanket bypass [ADOPTED]

- **Binds:** Super Admin surfaces, FR-072
- **Prevents:** Super Admin's platform-wide role silently reading gym-scoped data outside the escalation flow
- **Rule:** cross-gym aggregates go through `SECURITY DEFINER`, aggregate-only functions (`platform_metrics()`, `gym_member_count()`) that self-enforce `private.is_super_admin()` internally — never a broadened row-level SELECT policy. Row-level access to a specific gym's data requires the audit-logged escalation action (FR-072).

### AD-6 — Staff creation/role-ceiling: one canonical RPC pair, plus a service-role account-creation step

- **Binds:** Epic 9 (FR-087, FR-089, NFR-013)
- **Prevents:** the "caller cannot create/edit an equal-or-above role" rule drifting between the creation and edit/self-edit call sites; a second, divergent staff-activation UX
- **Rule:** `create_staff_member()` / `update_staff_role()` are `SECURITY DEFINER` RPCs that internally check caller-role-vs-target-role against a hard allowlist via `private.current_member_role()` (AD-3) — never a copy of `log_audit_event()`'s stale `auth.jwt() ->> 'app_role'` read. Hierarchy: `Owner → Supervisor → Manager → Receptionist → Coach → Member` (new `member_role` enum value: `supervisor`). Owner creates Supervisor/Manager/Receptionist/Coach; Supervisor creates Manager/Receptionist/Coach only (never Supervisor/Owner); **Manager creates nothing** — the RPC's allowlist has no row granting Manager any target role. This RPC pair is *not* the same shape as Story 1.5's Super-Admin gym/owner creation (that one bypasses RLS entirely as Super Admin); it runs inside the caller's normal Owner/Supervisor RLS session, with the ceiling check in the function body. Only the second step reuses a prior shape: because Postgres functions cannot call the Supabase Auth Admin API, a passing ceiling check gates a Server Action that then calls `supabase.auth.admin.createUser` via the service-role admin client, mirroring Story 1.5/1.11's account-creation step specifically (not their authorization model). New staff activation reuses Story 1.11's existing temp-password-over-WhatsApp mechanism; no second activation flow.

### AD-7 — No repository pattern; thin per-domain service layer [ADOPTED]

- **Binds:** all three apps
- **Prevents:** an app-side copy of authorization rules that RLS already owns
- **Rule:** `services/<domain>.ts` per app wraps `supabase-js`, typed via `packages/types`. Not shared across apps (Next.js and Expo use `supabase-js` in different runtime contexts).

### AD-8 — No custom REST/GraphQL API surface [ADOPTED]

- **Binds:** all three apps
- **Prevents:** a second authorization boundary competing with RLS
- **Rule:** apps call Supabase directly via `supabase-js`/`@supabase/ssr`. Operations with business logic beyond CRUD go through Next.js Server Actions, never raw client-side inserts.

### AD-9 — Server Actions/service functions return `{ data, error }`, never throw for expected errors [ADOPTED]

- **Binds:** all three apps
- **Prevents:** silent divergence on "throw vs. return" across independently-written call sites
- **Rule:** only genuine bugs throw (caught by Sentry). Expected, user-facing errors return `{ data: null, error: { code, message } }`.

### AD-10 — Swappable external integrations sit behind a provider-interface port, isolated to their seam [ADOPTED]

- **Binds:** payments, OTP delivery, general messaging
- **Prevents:** vendor lock-in at the one or two points where a Cameroon-market vendor is genuinely likely to be swapped or fail
- **Rule:** `PaymentProvider`, `OtpDeliveryProvider`, `WhatsAppMessageProvider` own the call contract only; entity shapes stay the generated type from `packages/types` so an interface can't silently redeclare and drift from the schema. Applied *only* at these seams — not a general architectural style.

### AD-11 — OTP delivery is an ordered runtime fallback chain [ADOPTED, 2026-08-08]

- **Binds:** `send-sms-hook`, any future `OtpDeliveryProvider` implementation
- **Prevents:** a new call site re-introducing single-provider coupling; Evolution API's availability gating OTP delivery
- **Rule:** `EvolutionApiProvider → TwilioWhatsAppProvider → TwilioSmsProvider → SentDmProvider`, all implementing `OtpDeliveryProvider`. Chain advances only on failure (network error, non-2xx, or `DeliveryResult.success:false`); first success short-circuits; every attempt logged. `EvolutionApiProvider` requires its own passed sandbox spike (Story 2.9) before joining the production chain — a spike failure leaves the existing 3-provider chain as the production path.

### AD-12 — `WhatsAppMessageProvider`: a second, narrower interface for free-text sends [ADOPTED, 2026-08-08]

- **Binds:** member invitations (FR-082), any future non-OTP send
- **Prevents:** forcing free-text sends through `OtpDeliveryProvider`'s code+locale-shaped contract
- **Rule:** `send(phone, message, locale) → DeliveryResult`. V1.5 ships `EvolutionApiMessageProvider`, called from a Server Action (`sendMemberInvite`), following the established Deno→Node porting precedent (`sendTempPasswordMessage.ts`). Adds no new Edge Function. Backed by a new platform-wide `messaging_provider_config` table (mirrors `tiers`' shape: one row, Super-Admin SELECT/UPDATE RLS, `log_audit_event`-audited writes) storing the active Evolution API instance ID — `send-sms-hook` and `sendMemberInvite` both read it via their service-role clients; updatable without a redeploy when a connected number disconnects.

### AD-13 — Payment provider is DB-row + RPC-driven runtime switching, not an env var [ADOPTED]

- **Binds:** payments (Flow A)
- **Prevents:** requiring a redeploy to switch the active payment provider
- **Rule:** `payment_providers` table, exactly-one-active enforced via a partial unique index (`idx_payment_providers_one_active`); the only write path is `activate_payment_provider()` (`SECURITY DEFINER`) — no direct INSERT/UPDATE/DELETE RLS policy for any role. `active_payment_provider()` is the one narrow read every gym-scoped session gets.

### AD-14 — SaaS billing (Flow B) is a separate table and RLS audience from member payments (Flow A)

- **Binds:** Epic 11 (FR-124–138); Epic 4's reconciliation job (FR-036/FR-137)
- **Prevents:** every existing Flow-A-only RLS policy and reconciliation query from needing a `flow`/nullable-`gym_id` branch it doesn't otherwise need, for two flows whose audiences are already fully disjoint; Epic 4's and Epic 11's independently-scheduled reconciliation jobs (AD-19: each cron job is its own independent transaction) silently disagreeing on what "discrepancy" means since they now touch different tables
- **Rule:** a new `saas_billing_payments` table, Super-Admin-scoped RLS, distinct from gym-scoped `payments`. `PaymentProvider` gains a discriminated routing context — `{type:'gym', gym_id}` selects a gym's Vault-stored Tara Money credentials, `{type:'platform'}` selects GymOS's own — at initiation, verification, and reconciliation. Mirrors the existing `job_runs`/`audit_log` precedent of platform-level concerns getting their own table rather than a nullable `gym_id` bolted onto a gym-scoped one. The single shared `payment-webhook` Edge Function dispatches on the routing context carried in the webhook's own reference/metadata (not a second Edge Function) to decide which table a given event resolves against; `payment_webhook_events` stays one shared log table (events are the DB-idempotency boundary regardless of flow) rather than splitting per-table. Both jobs' discrepancy detection (the 4-category classification from FR-036/FR-137, including the wrong-account-settlement category) is implemented as one shared function/module called by both cron jobs — the separate-table decision must not become a separate, silently-drifting discrepancy-semantics decision.

### AD-15 — Per-gym payment credentials are Vault-encrypted [ADOPTED, 2026-08-11]

- **Binds:** Epic 11's "connect payment account" flow (FR-126)
- **Prevents:** a second, app-layer encryption scheme when Supabase already ships one
- **Rule:** per-gym Tara Money credentials are stored in Supabase Vault — chosen over pgsodium/app-layer encryption as the least code to own and maintain.

### AD-16 — Money is integer + currency column, never a float [ADOPTED]

- **Binds:** all payment/subscription tables
- **Prevents:** floating-point rounding error in financial data
- **Rule:** XAF (and any future currency) stored as integer minor units with an explicit currency column.

### AD-17 — Webhook processing is idempotent [ADOPTED]

- **Binds:** `payment-webhook`
- **Prevents:** a duplicate webhook delivery double-processing a payment
- **Rule:** every webhook event is logged to `payment_webhook_events` before being acted on; signature verification (NFR-002) happens before any DB write.

### AD-18 — Subscription lifecycle is a four-state machine driven by a scheduled job [ADOPTED]

- **Binds:** subscriptions
- **Prevents:** ad hoc, scattered expiry logic across call sites
- **Rule:** `active → expiring_soon → grace_period → expired`, transitions owned by one `pg_cron` job. Grace period is gym-configurable (platform default 3 days). No proration on mid-cycle tier change (OQ-15) — the new price applies at the next billing cycle. A loyalty reward (AD-30) extends `expires_at` by R days inside the renewal-verifying transaction; it is not a state transition, and the job re-derives state from the extended date on its next run.

### AD-19 — Independent scheduled jobs, one table for job observability [ADOPTED]

- **Binds:** all `pg_cron` jobs
- **Prevents:** one job's failure silently blocking or corrupting another; a job queue's added complexity with no retry-with-backoff requirement to justify it
- **Rule:** each cron trigger is its own function/transaction, each logs to `job_runs` (job_name, started_at, finished_at, status, error). No shared trigger; no external job queue (BullMQ/graphile-worker) for this project's scale.

### AD-20 — Realtime has an explicit degrade path [ADOPTED]

- **Binds:** the front-desk alert panel and any future live dashboard surface
- **Prevents:** a retention-critical alert failing silently while the gym believes the safety net still exists
- **Rule:** dashboard falls back to short-interval polling if the Supabase Realtime channel drops.

### AD-21 — Bounded-capacity actions are a row-locked check-then-insert RPC, not a bare insert or a uniqueness index

- **Binds:** Epic 12 class booking (FR-105), class attendance (FR-107)
- **Prevents:** overbooking under concurrent requests; a second, disconnected source of truth for "did this member attend" once class attendance exists alongside floor check-in
- **Rule:** `book_class_session()` is a `SECURITY DEFINER` RPC that `SELECT ... FOR UPDATE`-locks the `class_sessions` row, counts existing bookings, and inserts only if under capacity — one atomic transaction, self-checking caller role/tenant like `check_in()`/`confirm_renewal()` already do. Distinct from the one-open-check-in invariant (AD-22): that is a 0-or-1 uniqueness constraint; this is a bounded count, which a partial unique index cannot express. Class attendance (a Receptionist marking a booked member present, FR-107) is an `attended_at` timestamp on `class_bookings` (0068 deviated from the original 'status column' wording), never a write to `attendance_events`/`check_in()` — FR-107 explicitly treats class attendance as distinct from floor check-in while reusing the same member-status rules (expired members can't be marked attended, and it triggers the same front-desk alert, FR-049); `attendance_events` remains floor-check-in-only. At a charging gym (V1.6), marking a Pay-per-session guest attended additionally calls the shared consumption function of AD-29 — it shares that function, never the `attendance_events` write. **Flagged as extrapolation from precedent, not a proposal-sourced decision** — confirm the RPC-vs-lighter-mechanism call during Epic 12 story-writing.

### AD-22 — One-open-check-in-per-member is a partial unique index [ADOPTED]

- **Binds:** attendance
- **Prevents:** a member holding two simultaneous open check-ins
- **Rule:** `idx_attendance_events_one_open_per_member`, a partial unique index — the DB-level enforcement of record, not an app-side pre-check alone.

### AD-23 — Offline support is scoped per-domain, each its own idempotent queue-item type — not a generic action queue [ADOPTED, extended]

- **Binds:** mobile check-in (V1.0), workout-completion logging (V1.5, FR-110)
- **Prevents:** queuing a generic action whose conflict-resolution rule is undefined (the V1.0 rationale this AD preserves — payments, class bookings, or any other stateful/capacity-checked action still do **not** get offline queueing)
- **Rule:** each offline-capable action is its own explicit, `client_id`-keyed queue-item type with its own conflict-resolution rule (check-in: timeout backfill; workout completion: idempotent upsert, no backfill concept needed). A queued guest check-in at a charging gym (FR-161) is a check-in item whose server-side outcome may now be *denied-and-recorded as an attempt* (AD-31) rather than backfilled; the queue item is complete either way, never retried. Class booking (AD-21) is explicitly excluded — its synchronous, row-locked capacity check has no offline-queueable equivalent; a queued booking could not honor `book_class_session()`'s atomicity guarantee. The mobile app's existing SQLite offline-queue infrastructure is reused, not duplicated, for the second item type. **Flagged as extrapolation from precedent, not a proposal-sourced decision** — confirm during Epic 13 story-writing.

### AD-24 — Progress photos live in a dedicated private bucket, never the public one [ADOPTED]

- **Binds:** Epic 10 (NFR-011)
- **Prevents:** copy-pasting the existing `member-photos` bucket's `public = true` setting onto a domain that needs per-photo, revocable consent
- **Rule:** a new Storage bucket, private, signed URLs, non-guessable paths. Per-photo coach-sharing consent (FR-095): default-off, immediate-revoke, non-retroactive viewing history — revocation invalidates any already-issued signed URL for that photo (short TTL, re-verified per photo), not just future issuance.

### AD-25 — Push notification dispatch is DB-triggered, not a service-layer responsibility [ADOPTED]

- **Binds:** all push notifications (N-01 through N-05 shipped; N-06/N-07 quiet-gym-alert and class-reminder extensions land under this same mechanism, Epic 6)
- **Prevents:** notification-sending logic scattering into individual Server Actions/service functions, each a separate place to get delivery/retry/token-cleanup wrong
- **Rule:** the `pg_net` Postgres extension calls Expo's Push API directly from a `send_push_notification()` Postgres function, invoked by cron jobs (subscription-lifecycle) and `AFTER INSERT/UPDATE` triggers (payments). Stale push-token cleanup happens in the same function on delivery failure. No new Edge Function — keeps AD's Edge-Function-count-is-a-design-property intact (Structural Seed).

### AD-26 — Member-cap enforcement is a DB trigger backstop, with a fast-fail duplicate check in the Server Action [ADOPTED]

- **Binds:** member creation and invitation (FR-086, Epic 9's staff creation is exempt — staff don't count against a gym's member cap)
- **Prevents:** any client-side-only cap check being bypassable; a slow, unfriendly failure at the DB layer for the common case
- **Rule:** a `BEFORE INSERT` trigger on `members` comparing active+deactivated count against the gym's tier cap (`tiers.member_cap`, nullable = unlimited; `gyms.member_cap_override`, nullable = use tier's own cap) is the enforcement of record — cannot be bypassed by any client. `createMember`'s Server Action performs the same check first for a fast, friendly failure before ever reaching the trigger; the trigger is the backstop, not the only line of defense.

### AD-27 — `payments.purpose` is a closed set, completed in one dispatcher [ADOPTED for `subscription`/`registration_fee`; `session` new in V1.6]

- **Binds:** registration fee (FR-152, shipped 0099–0101), session payments (FR-158, FR-162), every renewal path
- **Prevents:** a third payment kind being treated as a renewal by an unaware code path; per-purpose side effects scattered across webhook, RPCs, and triggers; two purposes quietly inheriting each other's late/duplicate rules
- **Rule:** `payments.purpose ∈ {subscription, registration_fee, session}`. Adding `session` amends, in one migration: the CHECK, the `protect_payment_purpose_and_void` pin, the staff-insert policy clause, the notification-trigger skip (a session payment sends no renewal push), and the revenue line (FR-143, FR-162 — its own line). Each purpose's effect lives in one shared `private.` function (renew / settle fee / create session + stamp), and every completion path — `complete_verified_payment()` for Tara webhooks, plus the manual paths (`confirm_renewal`, the 0031 staff-verify policy, the desk RPCs) — calls that function rather than re-implementing it; `complete_verified_payment()` branches on `purpose` and never falls through. **Late-confirmation rules are per purpose and intentional:** a late registration-fee confirmation is *not* applied (0100: only rows still `processing` complete; a staff-visible late-payment audit row instead), a late **session** confirmation *is* applied and raises an audit entry (FR-158) — a `session` payment flagged or settled to the wrong account (FR-036, NFR-019) never creates a session. Both outcomes are stored `flagged` today, so a reason discriminator (a column on `payments` or a distinct audit code, decided in the story) is required before the session branch ships — a late-confirmed payment must be distinguishable from a wrong-account one, or the rule cannot be implemented. Desk session payments take effect immediately via a definer RPC whose amount is read server-side from the plan, never passed in. At most one payment in flight per member and purpose is enforced the way 0100 does it for the fee: the initiating definer RPC takes the member lock, first calls the stale-expiry helper (a `processing` row older than ten minutes is flagged, audited, and no longer in flight), then checks — with a partial unique index over `status in ('pending','processing')` as the backstop, not the primary mechanism, because an index alone would wedge a member behind an abandoned row (cf. AD-22). A session payment reuses that helper rather than copying it. **Canonical lock order, everywhere:** `class_sessions` (AD-21) → payment row → member row → `attendance_events` → `subscriptions` → `guest_sessions` → `loyalty_progress`; the member lock is `FOR NO KEY UPDATE`, not `FOR UPDATE`, because a full `FOR UPDATE` on `members` deadlocks against the key-share locks FK inserts take. 0100's `complete_verified_payment` does not lock the member on the subscription path — the V1.6 story that makes it award a stamp must add that lock, and the daily sweep (AD-30) takes the same order per member.

### AD-28 — A session is one record type, `guest_sessions`, never a payment

- **Binds:** FR-158, FR-166, FR-169, FR-173
- **Prevents:** free sessions appearing as payments/receipts/revenue; two tables independently answering "does this member have a usable session"; a plan price change re-pricing sessions already bought
- **Rule:** one row per purchase or grant: `gym_id`, `member_id`, a source linked to **exactly one** of `payment_id` or a loyalty grant (CHECK XOR), `usable_until` (paid: payment + 7 days; free: grant + 60 days — durations from the platform config row, AD-30), `consumed_at`, `covered_day` (gym-local `date`, written at consumption and never recomputed), `voided_at`. Value is the amount of the linked payment, never the plan's current price. RLS: staff and the member read their own gym's rows; no role has a direct write policy — creation, consumption, void, and lapse are definer functions only. Refunds are direct inserts into `refunds` today, so the void/stamp-reversal rule (FR-162) is an `AFTER INSERT` trigger on `refunds` for `purpose = 'session'` payments (data layer, as FR-153 does for the fee), not a service-layer step. A refund that fully voids an unused session and a consumption that races it resolve under the member lock (AD-29) to exactly one outcome.

### AD-29 — Session consumption is one function under one member lock

- **Binds:** `check_in()` (online and offline-sync paths), class attendance marking (FR-174, AD-21), FR-159, FR-161, NFR-021
- **Prevents:** the dashboard, coach roster, sync, and member app each implementing "covered today?" with different clocks or different locks; an older app build bypassing the rule; a concurrent scan consuming a second session
- **Rule:** `private.consume_guest_session(member_id, gym_id, receipt_at)` takes `SELECT … FOR UPDATE` on the member row, then returns *covered*, *consumed*, or *denied*. It is called by `check_in()` and by class-attendance marking — and by nothing else. Because `attendance_events` and `class_bookings` currently grant direct INSERT/UPDATE/DELETE to `authenticated` and `service_role` (0006, 0058) and `service_role` bypasses RLS, the V1.6 migration revokes those direct write grants (after a grep for existing service-role writers) so the definer functions are the only write path; `mark_class_attendance()` gains an `attended_at is null` guard so a re-mark consumes nothing, and a partial unique index on `guest_sessions (member_id, covered_day) where consumed_at is not null` backs "one session per gym-local day" in the data layer. It applies only when the gym's charging flag is on **and** the member's current plan is Pay-per-session. Selection order: soonest-lapsing first, paid before free on tie. **Server receipt time governs** coverage, lapse and stamps; a client scan time is honored only for an offline scan within the gym's auto-timeout window (FR-045) and can never move a visit before its payment. "Day" is always `private.gym_local_day_bounds(gym timezone, at)` (0097), never UTC truncation. **Denial keeps the shipped `check_in()` contract**: it already returns `attendance_events` and signals "blocked, no event" with `null` (the expired-member branch, 0034/0090) while recording an alert; a session denial does the same — same signature, same `null`, no new result type — so older builds stay safe: the mobile client (`checkin.ts`) maps `null` to its `expired` outcome, so a denied guest is **not admitted** but sees expiry copy, not session copy — accepted for old builds. The current build's story must map a null result at a charging gym to the session-required state by reading the latest attempt (AD-31), and must not add a coded row to the return type (an old build would read any non-null row as success). The *reason* (session required) is read from the attempt/alert row (AD-31), never from the return value. Gym-not-active remains the one raised exception (0090). The stamp (FR-165) is awarded by this function's own call to `private.award_session_stamp()` (AD-30) inside the same lock and transaction — not by the caller. A Pay-per-session plan priced at 0 XAF is exempt (FR-156): the function returns *covered* without a session. Class attendance still never writes `attendance_events` (AD-21) — it shares only this function; `mark_class_attendance()` keeps its own signature and surfaces the same denial as a `{ code, message }` error (AD-9).

### AD-30 — Loyalty is an append-only ledger, written in the earning transaction

- **Binds:** FR-164–FR-170, NFR-022; every renewal-verification path (`confirm_renewal`, `renew_subscription`, `complete_verified_payment`, and the staff verification-queue path of 0031 — the story must enumerate by grep, not from this list)
- **Prevents:** a stamp granted twice under webhook redelivery or sync replay; the subscriber-stamp rule living in three renewal paths that drift; a balance anyone can hand-edit; progress shown live after its window
- **Rule:** `loyalty_events` is append-only (`stamp_earned`, `reward_granted`, `reward_consumed`, `reset`, `lapse`, `stamp_reversed`), unique-keyed on `(origin_id, event_type)` — the originating event being the consumed `guest_sessions.id` or the verified renewal `payment_id` — so one origin can legitimately yield a stamp, a reward, and a reversal but never two of the same so a replay inserts nothing. `loyalty_progress` (one row per member per gym, two counters — guest, subscriber) is derived and written only by the definer functions below, in the same transaction as the event that earns it. Subscriber stamps are awarded by **one** `private.award_renewal_stamp()` called from every renewal-verification path, evaluating on-time-ness (end of the day after expiry, gym-local) at verification, not initiation; the K-th reward extends the renewed subscription's expiry by R days in that same transaction and creates no payment. No role — Super Admin included — has any write path to either table other than those functions (FR-170); programme parameters (N, K, R) change only through the AD-32 setter. The 90-day reset and 60-day validity are platform defaults held as data on a platform config row (mirrors the `tiers` / `messaging_provider_config` shape, AD-12), not constants. A single `effective_loyalty(member_id)` read function (window-aware, per gym) is the only source for the member app (FR-169) and the dashboard member page — no client recomputes it. A refund recorded against a session payment (FR-162) calls `private.reverse_session_stamp()` from the same refund-recording function that voids/keeps the session (AD-28), in one transaction; the counter floors at 0 and never revokes a granted free session. **[ASSUMPTION]** resets, free-session lapses and unused-paid-session lapses are *persisted and audited* by a daily `pg_cron` sweep (AD-19, its own `job_runs` name), while every read computes the effective value and never writes — so a read is never a mutation and a past-window balance is never shown as live.

### AD-31 — Blocked attempts are evidence; the front-desk alert is only a notification

- **Binds:** FR-160, FR-161, FR-163, FR-174; AD-20, AD-25
- **Prevents:** blocked-attempt figures read from `front_desk_alerts` (rows dismissed on payment, so counts shrink); the new alert type breaking the existing CHECK and one-active-per-member index; a retried offline scan counted twice
- **Rule:** a `session_attempts` table (gym_id, member_id, scan id, occurred_at, source `check_in`|`class`) is unique on `(gym_id, member_id, scan_id)` where `scan_id` is not null and is the *only*. `scan_id` is the client scan id: online `check_in()` calls usually carry none, so each such denied scan is one attempt (a retry is a person trying again), and class marking has no client scan id, so the marking function generates one per action — dedup (FR-160) therefore applies to offline-synced scans, where it matters. It is the *only* source of the Guest-sessions card's blocked counts (server-side aggregate, FR-143's `max_rows` caveat). The alert is a `front_desk_alerts` row discriminated by a new `kind` column (existing rows backfilled `subscription_status`). `status` becomes nullable and its CHECK becomes `(kind='subscription_status' and status in (…three values…)) or (kind='session_required' and status is null)`; the one-active unique index is rebuilt over `(member_id, kind, coalesce(status,''))`. **The index swap and the rewrite of every `ON CONFLICT (member_id, status)` clause ship in one migration** or alert creation errors — the sites are in 0034, 0068 and 0090 (three), found by grep, not from this list. `front_desk_alerts_protect_columns` is extended to pin `kind`, and every dashboard alert query/panel filters or branches on `kind`. The row is created in the same transaction as the denial and dismissed by the session-payment definer function. Delivery reuses AD-20's channel and degrade path — no new channel, no new Edge Function.

### AD-32 — Audited gym settings have exactly one write path each

- **Binds:** `registration_fee` (FR-147, shipped), `charge_guests_per_session` (FR-157), loyalty enabled/N/K/R (FR-164), `category` (FR-171); the Settings page and Super Admin Create Gym
- **Prevents:** an Owner's direct `UPDATE gyms` (policy `owner_update_own_gym`) bypassing a role gate, audit entry, or confirmation count; a setting whose audit shape or role set differs between Settings and Super Admin
- **Rule:** each setting is written only by its own `SECURITY DEFINER` setter RPC (the `set_registration_fee()` shape, 0098) that checks role via `private.current_member_role()` (AD-3 — 0098's own setter reads the JWT `app_role`, grandfathered; new setters must not copy it), writes the audit row with old and new value, and is the sole holder of that setting's own GUC. **Each new setting gets its own BEFORE UPDATE pin trigger function** — not another branch in `protect_super_admin_only_gym_columns()`, which parallel stories would each `CREATE OR REPLACE` whole, the last writer silently dropping the others. Pinned against every writer except its setter; the `category` setter explicitly admits Super Admin (FR-171). Defaults are set at migration time: `charge_guests_per_session` is added `NOT NULL DEFAULT false` (existing live gyms stay off), then `ALTER COLUMN … SET DEFAULT true` for gyms created afterwards — a single `ADD COLUMN … DEFAULT true` would switch charging on for every live gym at deploy; loyalty defaults off; registration fee 0. `category` is stored as a stable code (never a label; EN/FR labels live in `packages/types`), set at Super Admin gym creation and editable by Owner/Supervisor through its setter. Turning charging on affects only visits from that moment and never touches an open check-in. FR-173 follows the same rule: a plan's type and price change only through a definer RPC that refuses a type change once the plan has subscriptions and audits every type/price change with old and new value; direct `UPDATE plans` for those columns is pinned.

## Consistency Conventions

| Concern | Convention |
| --- | --- |
| Naming (DB) | snake_case, plural tables (`members`, `payments`); FKs as `<singular>_id`; indexes as `idx_<table>_<column(s)>` |
| Naming (RPCs / Server Actions) | RPCs snake_case verb_noun (`renew_subscription()`); Server Actions camelCase verbNoun (`createMember`) |
| Naming (code) | Components PascalCase (file name matches); hooks `useX.ts`; shared types PascalCase, defined once in `packages/types` |
| Data shape boundary | `snake_case` for anything that is a DB row shape (matches `supabase gen types` directly); `camelCase` only for pure UI-local state/props that never round-trip to the DB |
| Dates | UTC `timestamptz` in DB and over the wire always; locale formatting only at UI render |
| Booleans | native Postgres `boolean`, never `0`/`1` |
| Soft delete | `deactivated_at` timestamp, never a boolean flag |
| Error shape | `{ code: string, message: string }` — `code` feeds one centralized error-mapping utility; `message` is already-localized EN/FR. Components never hand-write error copy |
| Validation | Zod schemas live once in `packages/types`, consumed by every write boundary (forms, Server Actions, Edge Functions) — never redefined inline |
| Function privileges | Every new function: `revoke execute … from public`, `from anon`, and (for service-role-only functions) `from authenticated`, then grant explicitly — the hosted project's default privileges grant EXECUTE to `anon` on new functions (0104 realigned the earlier ones). Stated in the same migration, never assumed from `from public` alone. |
| Realtime channels | `gym:<gym_id>:alerts` — scoped per gym in the channel name itself |
| Query cache keys | array convention `[domain, filters]`, e.g. `['members', { status: 'expired' }]` |
| Structure | tests co-located (`*.test.ts(x)`); pgTAP in `supabase/tests/`, one file per sensitive table; components organized by feature/domain, not generic type |
| Test OTP guardrail | `SMS_TEST_OTP` (phone→fixed-code map) lives in `supabase/config.toml` for local dev + staging **only**, a small explicitly-reserved test-number set, never a wildcard. Promoting config to production must explicitly drop it — a leaked test OTP in production lets anyone authenticate as any phone number. Required deployment-checklist step, not just a convention. |

## Stack

| Name | Version |
| --- | --- |
| Next.js (dashboard, super-admin) | 16.3.8 resolved in the lockfile (specifier is `latest`; registry latest 16.4.0 as of 2026-10-11 — pin a version before the next release train) |
| Expo SDK (mobile) | 57.0.20 (`~57.0.20`; React Native 0.86.3, React 19.2.3) |
| Turborepo + pnpm workspaces | Turborepo 2.10.3 (`^2.10.3`), pnpm 10.27.0 |
| Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) | Cloud, EU West (`eu-west-1`) |
| Supabase Vault | per-gym credential storage (AD-15) — extension `supabase_vault` 0.3.1, in production use since migrations 0052/0054/0083. Supabase publishes no GA status (features page: Public Alpha; extension README: Beta), so it is a known maturity risk, not a confirmed-GA dependency. Independent of the pgsodium deprecation. |
| TanStack Query | 5.104.x, `apps/dashboard` only (specifier `latest`) |
| shadcn/ui + Tailwind | dashboards only (Expo app styles independently) |
| Sentry | sole V1/V1.5 observability tool |
| Zod | 4.4.3 (`^4.4.3`), `packages/types`, single validation source |

## Structural Seed

```text
gymos/
  apps/
    dashboard/       # Gym Admin Dashboard (Next.js, App Router)
    super-admin/      # Super Admin Dashboard (Next.js, separate Vercel deployment)
    mobile/           # Member App (Expo Router)
  packages/
    types/            # ONLY shared package: generated DB types, Zod schemas, error mapping, shared admin locales
  supabase/
    migrations/       # 50+ to date, RLS-enabled in the same migration as CREATE TABLE
    functions/        # 3 Edge Functions: payment-webhook, send-sms-hook, gym-qr-display
    tests/            # pgTAP, one file per sensitive table + cross-cutting isolation/canary tests
  docs/
    decisions.md      # sandbox spikes, deviations, pattern amendments — the implementation-level decision log this spine's ADs summarize
```

**Deployment & environments:** Vercel (dashboard, super-admin — two separate projects, same monorepo, different root dirs), Supabase Cloud (EU West, `eu-west-1` — confirmed via measured RTT, a statistical tie with Frankfurt, retained to avoid churn on an empty-vs-populated project), EAS Build+Submit for mobile. GitHub Actions CI (`ci.yml`): typecheck, pgTAP against a **local** `supabase start` (edge runtime excluded), a Playwright E2E job, i18n hardcoded-string lint gate. There is no hosted-equivalent privilege assertion: 0104 showed local and hosted default privileges differ, so a function can pass CI yet be anon-executable in production (function-privileges convention below; a CI check against the hosted privilege shape is an open item). **Open, not decided:** migration release order and rollback policy for payment/check-in changes, backup/PITR posture, a staging environment, secrets rotation, and alerting on `job_runs` failures — each needs an owner before V1.6 ships to live gyms. Production is live with real pilot gyms (since 2026-09-10): a master merge reaches real users, so migrations that change a payment or check-in path ship behind their per-gym flag (AD-32).

**Edge Functions (exactly 3, each isolated to one external-facing concern):** `payment-webhook` (provider-generic signature verification + idempotent write — Tara Money is the current active provider via `payment_providers`, not a hardcoded name; dispatches Flow A/Flow B per AD-14), `send-sms-hook` (the `OtpDeliveryProvider` fallback chain, AD-11), `gym-qr-display` (Story 8.2, e-ink display endpoint, `gym_token` bearer secret). Adding a 4th requires a deliberate AD, not an ad hoc addition — the count is a design property (attack surface, runtime boundary), not an incidental fact.

**Named infra risk:** Evolution API (AD-11, AD-12) runs self-hosted, outside Supabase Cloud's or Vercel's managed SLA — the first platform dependency with that property. The OTP fallback chain (AD-11) is the explicit mitigation for OTP; `WhatsAppMessageProvider` (AD-12) has no equivalent fallback for invite sends, since it has exactly one implementation — an invite send failure surfaces to the Owner/Manager as a manual-send fallback in the dashboard UI (the pre-existing `InviteMemberModal`), not a silent drop. Story 2.9's sandbox spike should confirm recovery from an outright connector ban (unofficial WhatsApp gateways face automated ban detection, not just downtime), not only an availability outage.

```mermaid
erDiagram
    GYMS ||--o{ MEMBERS : has
    GYMS ||--o{ SUBSCRIPTIONS : has
    GYMS ||--o{ PAYMENTS : has
    GYMS ||--o{ ATTENDANCE_EVENTS : has
    GYMS ||--o{ CLASSES : has
    GYMS }o--|| TIERS : "assigned (platform-wide)"
    MEMBERS ||--o{ GUEST_SESSIONS : "paid or free, XOR-linked"
    PAYMENTS ||--o| GUEST_SESSIONS : "purpose=session buys (0..1)"
    MEMBERS ||--|| LOYALTY_PROGRESS : "per gym, two counters"
    LOYALTY_PROGRESS ||--o{ LOYALTY_EVENTS : "append-only ledger"
    LOYALTY_EVENTS }o--o| GUEST_SESSIONS : "grants / consumes"
    MEMBERS ||--o{ SESSION_ATTEMPTS : "blocked scans"
    MEMBERS ||--o{ SUBSCRIPTIONS : "plan history"
    MEMBERS ||--o{ PAYMENTS : makes
    MEMBERS ||--o{ COACH_ASSIGNMENTS : "assigned to"
    MEMBERS ||--o{ BODY_PROGRESS_ENTRIES : logs
    MEMBERS ||--o{ PROGRESS_PHOTOS : uploads
    MEMBERS ||--o{ CLASS_BOOKINGS : books
    MEMBERS ||--o{ WORKOUT_PLANS : "assigned"
    MEMBERS }o--|| USERS : "one platform account"
    COACH_ASSIGNMENTS }o--|| COACHES : "staff (member_role=coach)"
    COACHES ||--o{ WORKOUT_PLANS : authors
    CLASSES ||--o{ CLASS_SESSIONS : schedules
    CLASS_SESSIONS ||--o{ CLASS_BOOKINGS : "capacity-limited"
    PAYMENTS }o--o| SUBSCRIPTIONS : "renews (0..1)"
    GYMS ||--o{ SAAS_BILLING_PAYMENTS : "owes GymOS (Flow B, Super-Admin RLS)"
    JOB_RUNS }o--|| GYMS : "global, not gym-scoped"
    AUDIT_LOG }o--|| USERS : "actor, append-only"
```

## Deferred

- Shared `packages/ui` component library — until duplication between dashboards actually hurts.
- NativeWind / Tailwind-for-React-Native — current UX spec doesn't need it.
- Redis or any external cache layer — no scale justification at pilot size.
- A real job queue (BullMQ/graphile-worker) — until three independent `pg_cron` triggers stop being sufficient.
- PostHog analytics (NFR-014) — unhomed; fold into whichever of Epics 9–13 ships first as 1–2 stories, not its own epic.
- E2E coverage breadth (NFR-015) — Playwright is in CI (8 specs as of 2026-10-11); which V1.6 paths (guest check-in denial, desk session payment) get a spec is a story-level call.
- **OQ-14 (Flow B billing-job shape) is resolved in the finalized PRD v1.5**, not left open as the 2026-08-11 correct-course proposal's Section 4.1 originally framed it mid-session: Tara Money cannot auto-debit, so V1.5 ships reminder-to-approve billing (`prd.md` FR-130/FR-133, OQ-14). AD-14's data model (separate `saas_billing_payments` table, Owner-initiated via a payment link, not a collection job) was already shaped for exactly this — no architecture change follows from this resolution, it confirms AD-14 rather than blocking it.
- **OQ-7 is resolved** — the sandbox spike re-verification against GymOS's real activated business account (`9FmIZg9GBB`), swapping off the Temporal stand-in, passed in full (`docs/decisions.md`, 2026-08-13, Story 4.10; `prd.md` Open Questions table updated to match, 2026-08-17). This was an account-credential swap, not a data-model question; it didn't block any AD above, since AD-14/AD-15's credential-selection mechanism is account-agnostic. Full production reliance on Tara Money still awaits Story 4.12's cutover (backlog), tracked separately from OQ-7.
- OQ-12/13 (per `prd.md`'s Open Questions table) — carried forward from the PRD, not architecture-blocking.
- Free/test tier for beta-gym SaaS-billing exemption (FR-139) — a billing/product rule, not a structural decision; no new AD needed unless it turns out to require a new table shape beyond `saas_billing_payments`.
- **V1.7 backlog (PRD §12): gym landing pages, template module, country directory, SEO** — no AD yet; `category` (AD-32) is the only V1.6 hook. Subdomain/DNS policy (per-gym subdomains under `gymosapps.com` vs. the `owner.`/`portal.` login hosts) and tenant-name collision rules are the first decisions it will need; revisit at V1.7 planning.
- Per-category product wording (OQ-23), a per-gym auto-waive for Pay-per-session plans, exposing the 90-day/60-day loyalty windows per gym, and reward push notifications — all explicitly out of V1.6; the data model (AD-30 config row, AD-28 sources) leaves room without a migration of existing rows.
- Reactivated-member re-payment of the registration fee (OQ-17) — not decided; AD-32 setter and AD-27 purpose set are unaffected either way.
- Class/workout entity detail (columns, exact cardinalities beyond the ERD above) — left to Epic 12/13 story-writing; the ERD fixes only what another epic could build incompatibly against (that these are gym-scoped, that bookings are capacity-checked, that plans belong to one member).
