---
baseline_commit: 207c9faa429b878c239b59d0b1a4b2c7deefe67e
---

# Story 6.2: Subscription Lifecycle Notifications (N-01, N-02, N-03)

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a member,
I want to be notified as my membership approaches and reaches expiry,
so that I can renew before losing access.

## Acceptance Criteria

1. **Given** a member's expiry date is exactly 7 days away, **when** the lifecycle cron job transitions the subscription from `active` to `expiring_soon`, **then** push N-01 (`Membership expiring — 7 days`) is queued through `private.send_push_notification()` for every registered Expo token belonging to that member's user account, in the member's preferred language.
2. **Given** an `expiring_soon` member's expiry date is exactly 1 day away, **when** the lifecycle job runs, **then** push N-02 (`Membership expiring — 1 day`) is queued once for that subscription lifecycle in the member's preferred language.
3. **Given** a subscription transitions to `expired` after its gym-configured grace period elapses, **when** the lifecycle job runs, **then** push N-03 (`Membership expired`) is queued once for that subscription lifecycle in the member's preferred language.
4. **Given** the same lifecycle job is run more than once on the same day, a late job skips one or more notification dates, or a member has no registered push token, **when** dispatch is evaluated, **then** no duplicate or retroactive lifecycle notification is queued, the job completes without error, and existing lifecycle state-transition behavior is preserved.
5. **Given** a push delivery returns Expo's `DeviceNotRegistered` error, **when** the notification delivery processor handles the push ticket or receipt, **then** the matching stale token is removed through `private.cleanup_invalid_device_push_token()` and unrelated users' tokens remain untouched.
6. **Given** a member's `users.preferred_language` is `fr`, **when** N-01, N-02, or N-03 is built, **then** the French title/body is sent; `en`, an unsupported value, or a missing effective value uses the English fallback. The notification data payload includes `notificationCode`, `subscriptionId`, and `gymId`.
7. **Given** N-01 through N-03 are mandatory V1 lifecycle notifications, **when** dispatch eligibility is evaluated, **then** no `member_preferences` opt-out can suppress them and this story adds no preference UI or non-critical notification settings.

## Tasks / Subtasks

- [x] **Task 1: Add the notification transport and idempotency migration** (AC: #1–#7)
  - [x] Create the next sequential migration, `supabase/migrations/0045_subscription_lifecycle_notifications.sql`; enable `pg_net` in the `extensions` schema with `create extension if not exists pg_net with schema extensions`.
  - [x] Add `private.notification_dispatches` and `private.notification_deliveries`, separating one logical lifecycle event from its per-device deliveries. Use a unique key on `(subscription_id, notification_code)` so rerunning the lifecycle job cannot enqueue N-01/N-02/N-03 twice for the same subscription lifecycle. Existing renewal functions insert a new `subscriptions` row, so the subscription ID also distinguishes future renewal cycles. Use explicit enum/check values for `N-01`, `N-02`, and `N-03`; do not generalize payment notifications owned by Story 6.3.
  - [x] Track each device delivery independently, including the Expo token, the `pg_net` push request ID, Expo ticket ID when returned, receipt request ID when queued, status, error code/message, and timestamps. A user can have multiple device tokens and one platform user can have memberships at multiple gyms.
  - [x] Enable RLS on new tables in the same migration. They are server-internal transport state in the non-exposed `private` schema: grant only the minimum access needed by the Postgres-owned cron/functions and `service_role`; add no authenticated/anon read or write path.
  - [x] Add supporting indexes for due delivery processing and request/receipt correlation. Do not alter the composite uniqueness or user-scoped RLS established on `device_push_tokens` in Story 6.1.

- [x] **Task 2: Implement bilingual lifecycle message construction and Expo enqueueing** (AC: #1–#4, #6, #7)
  - [x] Implement `private.send_push_notification(p_subscription_id uuid, p_notification_code text)` as the single reusable server-side dispatch entry point. It must derive `member_id → members.user_id → users.preferred_language`, `gym_id/gyms.name`, and every `device_push_tokens` row; callers must not pass arbitrary token, user, language, or message text.
  - [x] Validate the notification code allowlist and fail closed for unknown codes. Use `fr` only when `lower(preferred_language) = 'fr'`; otherwise use English so a future/invalid language value never produces blank copy.
  - [x] Use these reviewed V1 messages (gym name disambiguates users who belong to multiple gyms):
    - [x] N-01 EN: title `Membership expiring — 7 days`; body `Your {gym_name} membership expires in 7 days.`
    - [x] N-01 FR: title `Abonnement bientôt expiré — 7 jours`; body `Votre abonnement à {gym_name} expire dans 7 jours.`
    - [x] N-02 EN: title `Membership expiring — 1 day`; body `Your {gym_name} membership expires tomorrow.`
    - [x] N-02 FR: title `Abonnement bientôt expiré — 1 jour`; body `Votre abonnement à {gym_name} expire demain.`
    - [x] N-03 EN: title `Membership expired`; body `Your {gym_name} membership has expired. Renew to restore access.`
    - [x] N-03 FR: title `Abonnement expiré`; body `Votre abonnement à {gym_name} a expiré. Renouvelez-le pour rétablir votre accès.`
  - [x] POST Expo-shaped JSON only to `https://exp.host/--/api/v2/push/send` through `net.http_post`, with `Content-Type: application/json`, `to`, `title`, `body`, `sound: "default"`, and a data object containing camelCase `notificationCode`, `subscriptionId`, and `gymId`. Do not call FCM/APNs directly and do not create an Edge Function.
  - [x] Insert the logical dispatch row first with conflict-safe idempotency. If it already exists, return without issuing another HTTP request. If the member has no device token, treat it as a safe no-op while retaining enough dispatch outcome to make reruns deterministic and observable. (`members.user_id` is non-null and FK-backed; do not invent an impossible “unlinked member” fixture.)
  - [x] Keep mandatory lifecycle dispatch independent of `member_preferences`; Story 6.4 owns non-critical preferences. Do not add a UI, deep-link navigation, badge count, or foreground-notification handler.
  - [x] Revoke public execution. Grant only the role(s) actually needed by the Postgres-owned lifecycle/processor jobs; ordinary `authenticated` and `anon` callers must not be able to forge pushes.

- [x] **Task 3: Process Expo push tickets/receipts and wire stale-token cleanup** (AC: #5)
  - [x] Implement a private delivery processor that consumes completed `pg_net` responses, correlates each response to its delivery row, and distinguishes: HTTP/transport failure, Expo push-ticket error, accepted ticket ID, successful receipt, and receipt error.
  - [x] For an accepted Expo ticket, queue the documented receipt lookup (`https://exp.host/--/api/v2/push/getReceipts`) and persist the receipt request ID. Do not mark a ticket as delivered merely because Expo accepted it.
  - [x] On `DeviceNotRegistered` from either a ticket or receipt, call the existing Story 6.1 primitive `private.cleanup_invalid_device_push_token(expo_push_token)` and mark the delivery terminal. Never delete tokens for unrelated delivery rows.
  - [x] Schedule the processor frequently enough to consume `pg_net` responses before its response-table TTL. Treat it as the notification transport's companion worker, not a fourth domain lifecycle job; use a stable named `cron.schedule()` entry so resets/migrations cannot create duplicates.
  - [x] Keep delivery failures observable in the delivery ledger and non-fatal to later rows. Do not add automatic resend/backfill behavior unless explicitly required; idempotency must remain stronger than retry convenience in V1.

- [x] **Task 4: Extend `run_subscription_lifecycle_job()` without regressing Story 3.1** (AC: #1–#4, #6, #7)
  - [x] Replace the function with `create or replace function` in migration 0045; do not edit migration 0021. Preserve its search path, privilege boundary, inner exception/savepoint behavior, `job_runs` success/failure logging, audit failure logging, state ordering, pay-per-session exclusion, 02:00 Africa/Douala schedule, and Super Admin failure visibility.
  - [x] N-01 eligibility is exact-date only: `expiry_date = current_date + 7` and a real `active → expiring_soon` transition. The existing `<= current_date + 7` state transition must still catch late rows, but late rows must not receive retroactive N-01.
  - [x] N-02 eligibility is exact-date only: `expiry_date = current_date + 1`, normally while already `expiring_soon`. It is a timed lifecycle event, not a status transition.
  - [x] N-03 eligibility is only rows actually changed to `expired` by that run. Capture the `UPDATE ... RETURNING` subscription IDs and dispatch N-03 from that transition set; never notify already-expired rows again.
  - [x] Queue notifications inside the job transaction so a state-transition failure cannot commit orphan dispatch intent. Preserve most-progressed-state-first transition semantics and ensure a notification failure is handled according to the existing job failure contract rather than silently corrupting lifecycle state.
  - [x] Preserve the current strict boundary: `expiry_date + grace_period_days = current_date` remains `grace_period`; it becomes `expired` only when the sum is `< current_date`.

- [x] **Task 5: Regenerate database types and document the decision** (AC: #1–#7)
  - [x] Regenerate `packages/types/src/database.ts` from the successfully reset local schema and inspect the diff. The new ledger tables/helpers live in `private`, so they should remain absent; no unintended public API should appear.
  - [x] Add a dated `docs/decisions.md` entry covering: direct Expo service routing through `pg_net`; the logical-dispatch/per-device-delivery idempotency model; exact-date/no-backfill semantics; N-03 firing on the story's `expired` transition after grace; the ticket-versus-receipt distinction; and reuse of Story 6.1 cleanup.
  - [x] Record the source conflict explicitly: PRD FR-075 summarizes N-03 as “on expiry date,” but Story 6.2's acceptance criterion says “status transitions to expired.” Because GymOS deliberately has a configurable grace period and the story AC is the implementation contract, N-03 fires on actual `expired` transition after grace. Do not silently reinterpret this during development.

- [x] **Task 6: Add comprehensive pgTAP coverage** (AC: #1–#7)
  - [x] Add `supabase/tests/subscription_lifecycle_notifications.test.sql` with deterministic fixtures for EN, FR, unsupported-language fallback, multiple device tokens, no token, pay-per-session, and two gyms for one user.
  - [x] Assert N-01 queues only for the exact +7-day transition, N-02 only at +1 day, and N-03 only for a newly expired row after grace. Assert +6-day late rows, already-expired rows, and exact grace-boundary rows do not receive the wrong notification.
  - [x] Run the lifecycle job twice and prove the second run adds no logical dispatches and no `pg_net` requests. Prove one logical event fans out once per registered device without duplicating the logical dispatch.
  - [x] Inspect the queued request payload rather than making real network calls in pgTAP. Assert endpoint, headers, Expo token, exact EN/FR title/body, `sound`, and camelCase data keys/values.
  - [x] Mock/seed processor inputs for accepted tickets, successful receipts, `DeviceNotRegistered`, other Expo errors, malformed JSON, missing/expired response rows, and HTTP failures. Prove only `DeviceNotRegistered` invokes cleanup and only the matching token is deleted.
  - [x] Add negative privilege tests proving `anon`/`authenticated` cannot execute private dispatch/processor helpers or read/write internal delivery state.
  - [x] Keep all existing `supabase/tests/subscription_lifecycle_cron.test.sql` assertions passing unchanged unless an assertion count must be expanded for a directly related regression; do not weaken its boundary/idempotency coverage.

- [x] **Task 7: Validate from a clean database and perform one controlled live delivery check** (AC: #1–#7)
  - [x] Run `supabase db reset`, the full `supabase test db` suite, type generation/diff verification, `pnpm run typecheck`, and `pnpm run lint` (plus `pnpm run check:i18n` if any application localization file is touched, though none is expected).
  - [x] Confirm the named lifecycle and delivery-processor cron entries exist exactly once and retain the intended schedules/owner.
  - [x] Using the physical Android/EAS setup already established in Story 6.1, seed a throwaway subscription/token fixture, invoke the lifecycle job for one eligible notification, and verify the device receives the correctly localized push. Do not use a real member's subscription or phone number.
  - [x] Record live-test limitations honestly. If Expo credentials/network access prevent the controlled delivery, leave automated contract coverage complete and document the external blocker; do not claim an end-to-end push was received.

## Dev Notes

### Scope and Non-Negotiable Decisions

- **This is a database/backend story.** Expected production changes are migration(s), generated database types, tests, and the decision log. No mobile UI change is required: Story 6.1 already registers Expo tokens, and Story 6.2 only sends lifecycle pushes.
- **Extend, do not replace, Story 3.1.** `supabase/migrations/0021_subscription_lifecycle_cron.sql` already owns the correct lifecycle state machine, 02:00 WAT cron schedule, job logging, failure audit, late-run absolute-date behavior, and strict grace boundaries. Migration 0045 must use `create or replace` and preserve all of them.
- **Reuse Story 6.1 exactly.** `device_push_tokens` belongs to `users` and intentionally has no `gym_id`; its unique key is `(user_id, expo_push_token)`. Use `private.cleanup_invalid_device_push_token()` for invalid tokens. Do not redesign token ownership or add direct authenticated deletion.
- **One user can belong to multiple gyms.** Dispatch starts from a `subscription_id`, not only `user_id`, and payload/copy includes gym identity. Every device registered to the linked platform user receives the event.
- **No duplicate/backfill behavior.** N-01 and N-02 use exact calendar dates. A late job still advances state (Story 3.1) but does not send missed reminders. The unique logical dispatch key makes same-day reruns harmless.
- **N-03 contract resolution.** Fire when the subscription actually transitions to `expired` after grace, per this story's AC. Do not fire on the raw expiry date while the subscription remains in grace.
- **Mandatory means no preference lookup.** N-01–N-03 cannot be opted out of in V1. `member_preferences` and non-critical N-06/N-07 belong to Story 6.4.
- **Expo delivery is two-stage.** A push ticket means Expo accepted the message; it is not proof that FCM/APNs delivered it. Receipt processing is required for reliable `DeviceNotRegistered` cleanup. `pg_net` is asynchronous, so response processing must occur after the enqueueing transaction rather than pretending the response is synchronously available.
- **No new Edge Function and no direct FCM/APNs integration.** This preserves the architecture's two-Edge-Functions boundary.

### Existing Files to Update

- `supabase/migrations/0021_subscription_lifecycle_cron.sql` — **read-only precedent**. Current state: three ordered updates (`expired`, `grace_period`, `expiring_soon`), success/failure `job_runs`, failure audit, cron at `0 1 * * *`. Story change: none to this historical file; migration 0045 replaces the function. Preserve every behavior described above.
- `supabase/tests/subscription_lifecycle_cron.test.sql` — current 16-assertion baseline for lifecycle transitions, exact boundaries, idempotent end state, job success, expiry constraint, and Super Admin permission. Preserve as regression coverage.
- `supabase/migrations/0042_expo_push_token_registration_cleanup.sql` — current token table/RLS and private cleanup primitive. Story change: none; call its private function from the new processor.
- `packages/types/src/database.ts` — regenerate after migration; do not hand-edit generated structures.
- `docs/decisions.md` — append a dated decision; preserve all prior decisions.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — workflow tracking only; updated by BMAD, not application code.

### Architecture and Security Guardrails

- Keep extensions in `extensions`, public callable domain functions in `public`, and privileged internals in `private` with pinned `search_path` and explicit `REVOKE`/`GRANT` statements.
- Every new table gets RLS enabled in the same migration. Use explicit grants and explicit per-action policies when a client role truly needs access; internal delivery state should not be client-readable.
- Never expose Expo tokens in a notification payload, application response, audit record, or user-facing error.
- Do not log one audit event per push. Transport state belongs in the delivery ledger; the existing append-only audit log remains for specified sensitive/domain events and lifecycle-job failures.
- Use database `current_date`, matching Story 3.1 and the configured WAT cron timing. Do not derive eligibility from application/device clocks.
- Preserve transactional integrity: logical dispatch creation and lifecycle changes belong to the same job transaction; `pg_net` starts network requests after commit.

### Testing Requirements

- Follow existing pgTAP fixture patterns: transaction + `plan(...)`, deterministic UUIDs, direct lifecycle invocation, inspect queued DB state, `finish()`, rollback.
- Tests must never send a real Expo request. Assert `pg_net` queue/payload state within the test transaction and inject response fixtures for processor coverage.
- Highest-risk regressions: duplicate reminders on rerun; N-03 before grace ends; missed EN fallback; one user's invalid token cleanup deleting another user's token; ordinary authenticated users invoking server-only push helpers; lifecycle transition rollback/logging changes.
- Full regression gate: clean database reset, all pgTAP tests, generated-types diff inspection, monorepo typecheck, lint.

### Previous Story Intelligence (Story 6.1)

- Story 6.1 created migrations 0042–0044, `device_push_tokens`, the cleanup lookup index, a collision-safe table-specific `updated_at` trigger, push-token RLS tests, and mobile token registration.
- Live Android testing caught an important Expo distinction: `addPushTokenListener()` yields a native FCM token, not an Expo token. The client was corrected to re-fetch via `getExpoPushTokenAsync()`. Server delivery must therefore continue to use stored `ExponentPushToken[...]` values and the Expo Push Service only.
- The Story 6.1 worktree includes user changes and post-review fixes. Do not overwrite or revert them while implementing this story.

### Git Intelligence

- Recent Story 6.1 commits favor small, concern-specific changes: migration/cleanup index tests, generated type updates, and isolated mobile unit tests. Keep Story 6.2's transport, lifecycle integration, and tests reviewable even if implemented in one migration.
- The current worktree is intentionally dirty with BMAD installation/customization and Story 6.1 follow-up changes. Preserve unrelated modifications and never use destructive reset/checkout commands.

### Latest Technical Information

- Expo's server contract separates push tickets from push receipts; `DeviceNotRegistered` requires stopping sends to that token. See [Expo: Send notifications with the Expo Push Service](https://docs.expo.dev/push-notifications/sending-notifications/).
- `pg_net` performs asynchronous HTTP requests and exposes responses after transaction commit. The design must not attempt to synchronously read a response from the same transaction that called `net.http_post`. See [Supabase pg_net extension](https://supabase.com/docs/guides/database/extensions/pg_net) and [pg_net README](https://github.com/supabase/pg_net).
- Keep the implementation compatible with the repository's installed Supabase/Postgres extension versions; do not introduce an npm dependency for server-side push delivery.

### Project Structure Notes

- New migration: `supabase/migrations/0045_subscription_lifecycle_notifications.sql`.
- New tests: `supabase/tests/subscription_lifecycle_notifications.test.sql` and, if needed to isolate privilege assertions, `supabase/tests/subscription_lifecycle_notifications.negative.test.sql`.
- Updated generated type: `packages/types/src/database.ts`.
- Updated decision record: `docs/decisions.md`.
- No expected changes under `apps/dashboard`, `apps/super-admin`, or mobile UI/routes/components.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 6, Story 6.2; FR-074–FR-078]
- [Source: `_bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md` — §6.15 Push Notifications, FR-074–FR-078]
- [Source: `_bmad-output/planning-artifacts/architecture.md` — Background jobs; Gap 1 push-notification dispatch resolution; project structure]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` — Foundation/Localization]
- [Source: `supabase/migrations/0021_subscription_lifecycle_cron.sql` — lifecycle state machine, transaction/failure handling, cron schedule]
- [Source: `supabase/tests/subscription_lifecycle_cron.test.sql` — lifecycle boundary and idempotency regression contract]
- [Source: `supabase/migrations/0042_expo_push_token_registration_cleanup.sql` — token ownership, RLS, cleanup primitive]
- [Source: `_bmad-output/implementation-artifacts/6-1-expo-push-token-registration-cleanup.md` — previous-story scope, review fixes, and live-device findings]

## Change Log

- 2026-08-04: Implemented Story 6.2 lifecycle push transport, exact-date dispatch integration, Expo ticket/receipt processing, stale-token cleanup, decision documentation, and comprehensive pgTAP/privilege coverage; moved to review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-08-03: Task 1 RED — the initial 12-assertion pgTAP contract failed on the missing ledgers, RLS, uniqueness, and indexes as expected.
- 2026-08-03: Task 1 GREEN — clean `supabase db reset`, focused 12/12 pgTAP assertions, then full suite 651/651 passed.
- 2026-08-03: Task 2 RED/GREEN — 20 dispatch/payload assertions failed against the missing function; after implementation the focused suite passed 33/33 and the full suite passed 672/672.
- 2026-08-03: Task 3 RED/GREEN — 16 processor/cron assertions failed against the missing worker; after implementation the focused suite passed 54/54 and the full suite passed 693/693.
- 2026-08-03: Task 4 RED/GREEN — original lifecycle behavior passed while seven notification assertions failed; after replacement the focused suite passed 74/74 and the full suite passed 713/713.
- 2026-08-03: Task 5 — regenerated public database types from the clean schema; semantic diff and private API leak checks were empty (raw diff was CRLF/LF only). Appended the dated transport/timing/receipt/cleanup decision. A known real-cron timing race caused one interim unrelated assertion failure; immediate reset plus full rerun passed 713/713.
- 2026-08-03: Task 6 — completed 80 positive/integration and 12 negative privilege assertions; focused 92/92 and full 731/731 database assertions pass without changing Story 3.1's existing test.
- 2026-08-04: Task 7 final gate — clean reset applied all 45 migrations; full suite passed 731/731; generated-type semantic diff/private API leak checks were empty; monorepo typecheck passed 4/4; `git diff --check` passed; lifecycle (`0 1 * * *`) and processor (`* * * * *`) cron entries each exist once as `postgres`.
- 2026-08-04: `pnpm run lint` was executed but remains blocked by baseline-only issues: mobile `expo lint` cannot resolve `eslint`, and unchanged baseline dashboard files have four existing lint errors. Story 6.2 changes no app source. Super Admin lint completes with one warning and no errors.
- 2026-08-04: Controlled physical-device follow-up used a throwaway Android development-build account and subscriptions. The device registered one Expo token. Before Android FCM V1 credentials were uploaded, N-01 correctly persisted Expo's terminal `InvalidCredentials` ticket error. After credential setup, Expo/FCM returned successful receipts; with GymOS backgrounded and its Android notification category enabled, the device visibly received the French N-03 notification (`Abonnement expiré`). This verifies live registration, localized enqueueing, Expo ticket/receipt processing, terminal error observability, and physical-device display without real member data.

### Implementation Plan

- Build the private logical-dispatch/per-device-delivery ledger first, with catalog-level pgTAP coverage and deny-by-default access.
- Add one derived-input dispatch function for bilingual Expo payloads, then an asynchronous ticket/receipt processor with exact-token cleanup.
- Replace the lifecycle job in migration 0045 while preserving Story 3.1's transaction, transition ordering, logging, boundaries, and schedule.
- Finish with deterministic processor/lifecycle/privilege coverage, clean-schema type generation, documentation, and full repository validation.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story contract resolves N-03 timing in favor of the Story 6.2 acceptance criterion: notify on actual `expired` transition after grace, not on raw expiry date.
- Delivery guidance explicitly models Expo ticket/receipt processing and asynchronous `pg_net` behavior so Story 6.1 invalid-token cleanup can be wired truthfully.
- Task 1 complete: added RLS-protected logical dispatch and per-device delivery ledgers with idempotency and request/receipt correlation indexes; clean reset and all 651 database assertions pass.
- Task 2 complete: added derived-input bilingual Expo enqueueing with exact reviewed copy, per-token fan-out, no-token observability, multi-gym scoping, mandatory delivery, and conflict-safe no-duplicate behavior; all 672 database assertions pass.
- Task 3 complete: added isolated push-ticket/receipt processing, exact-token cleanup for `DeviceNotRegistered`, observable terminal failures, missing-response tolerance, and one stable every-minute processor cron; all 693 database assertions pass.
- Task 4 complete: extended the existing lifecycle job with exact-date/no-backfill N-01/N-02 and transition-only post-grace N-03 while preserving Story 3.1 state, logging, privilege, transaction, and schedule behavior; all 713 database assertions pass.
- Task 5 complete: verified generated public types have no semantic change or private notification API exposure, and documented direct Expo routing, two-level idempotency, exact-date semantics, post-grace N-03 contract resolution, ticket/receipt handling, and cleanup reuse.
- Task 6 complete: added deterministic positive, boundary, idempotency, payload, processor, cleanup-isolation, and negative privilege coverage; all 731 database assertions pass.
- Task 7 complete: clean database, full pgTAP, generated-type, typecheck, cron, and diff gates pass. Lint failures are confirmed unchanged from baseline. A controlled Android follow-up registered a throwaway Expo token, confirmed `InvalidCredentials` handling before FCM setup, and—after the Android FCM V1 credential was uploaded—completed real Expo ticket/receipt processing and visibly received the correctly localized French N-03 notification on the physical device.

### File List

- `_bmad-output/implementation-artifacts/6-2-subscription-lifecycle-notifications-n-01-n-02-n-03.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `supabase/migrations/0045_subscription_lifecycle_notifications.sql` (new)
- `supabase/tests/subscription_lifecycle_notifications.test.sql` (new)
- `supabase/tests/subscription_lifecycle_notifications.negative.test.sql` (new)
- `docs/decisions.md` (modified)
