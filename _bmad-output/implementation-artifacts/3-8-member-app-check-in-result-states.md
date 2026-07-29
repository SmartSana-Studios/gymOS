---
baseline_commit: 8a80e364ea936f5b02d784822da0875703f12f68
---

# Story 3.8: Member App — Check-In Result States

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want clear feedback after scanning the gym QR,
so that I know immediately whether I've been let in.

## Acceptance Criteria

1. **Given** a successful online check-in, **when** the scan completes, **then** a green confirmation with timestamp is shown and auto-dismisses after 2.5 seconds. [Source: epics.md#Story 3.8; FR-060] **Already implemented by Story 3.4** (`apps/mobile/src/app/(tabs)/checkin.tsx`'s `success` overlay) — this story only needs to verify it still behaves correctly, not rebuild it. See Scope Note #2 for why no regression is expected.
2. **Given** a successful offline check-in, **when** the scan completes without connectivity, **then** a green confirmation with a "syncing" indicator is shown, and the check-in syncs when connectivity resumes. [Source: epics.md#Story 3.8; FR-060/FR-061] **Deferred to Story 3.9 — not implemented in this story.** See Scope Note #1 for why.
3. **Given** an expired (beyond grace) member scans, **when** the server rejects the check-in, **then** a full-screen red "Access denied" state is shown that does not auto-dismiss. [Source: epics.md#Story 3.8; FR-031; FR-060; EXPERIENCE.md#MA-10] **This is the only new work this story delivers** — see Scope Note #2.

## Tasks / Subtasks

- [x] **Task 1: Migration `0027` — reject check-in for expired members in `check_in()`** (AC #3; Scope Note #2)
  - [x] `supabase/migrations/0027_member_app_check_in_result_states.sql`: `create or replace function check_in()`, re-declaring the full body of `0023_member_check_in_one_open_session_enforcement.sql`'s `check_in()` with one addition — a subscription-status lookup and guard inserted immediately after the existing `deactivated_at` check (before the `for update` open-session lock), exactly per Scope Note #2's snippet.
  - [x] Treat a member with **no** `subscriptions` row identically to `expired` (deny) — do not add a 6th, undocumented UI state for this case (Scope Note #2).
  - [x] Raise a distinguishable exception message (e.g. `'check_in: member % subscription is expired'`) so the client can pattern-match it the same way it already matches `'already has an open check-in'`.
  - [x] Do **not** write to `audit_log` for a denied attempt, and do not add any new table/column for the dashboard front-desk alert — that's Epic 4's job (Scope Note #3).
- [x] **Task 2: Mobile — `apps/mobile/src/services/checkin.ts`: surface the new rejection**
  - [x] Add `'expired'` to `RecordCheckInResult['status']`.
  - [x] In `recordCheckIn()`, add a check for the new exception message (same `error.message?.includes(...)` style already used for `'already has an open check-in'` and the `23505` backstop) returning `{ status: 'expired' }`.
- [x] **Task 3: Mobile — `apps/mobile/src/app/(tabs)/checkin.tsx`: new "Access denied" result state** (AC #3; Scope Note #2/#4)
  - [x] Add a `deniedExpired` boolean state alongside the existing `wrongQr`/`networkError`/`alreadyCheckedIn`/`success` states; include it in `resultShowing` (so the camera pauses and the idle pulse/nudge timers stop while it's shown) and in `resetScanning()`'s reset list.
  - [x] In `handleBarcodeScanned`, branch on `checkInResult.status === 'expired'` → `setDeniedExpired(true)` (same place the existing `'already_checked_in'` branch lives, before the success-flash path).
  - [x] Render a new full-screen overlay (does **not** auto-dismiss): reuse the existing `overlay` box layout, new `overlayDenied` style with a solid red background (`#B3261E` — the one existing "strong red" in this codebase, `apps/mobile/src/app/(tabs)/index.tsx`'s error-card text color; do not invent a new hex), large `✕` icon (reuse the existing text-as-icon convention, same character already used for the header close button — no new icon library).
  - [x] Button label "See front desk" — **on press, navigate back to Home** (`router.navigate('/')`, same as `handleClose`), **not** `resetScanning()` — this is the one button in this screen that doesn't return to the scanning state, since the member shouldn't be invited to rescan immediately after a hard denial.
  - [x] Update the file's own top-of-file doc comment (currently: *"Denied - Expired is Epic 4's job (subscription-status branching); Success - Offline is Story 3.9's job."*) — the Epic 4 attribution is now wrong; correct it to attribute the Denied-Expired state to this story (3.8), keeping the Story 3.9 attribution for Success-Offline as-is.
- [x] **Task 4: i18n — new `checkin.*` keys** (AC #3)
  - [x] Add to both `apps/mobile/src/locales/en.json` and `fr.json`, following this file's existing per-screen-duplication convention (`checkin.checkedIn` already duplicates `home.checkedIn` rather than being shared) — do not reuse the `home.seeFrontDesk*` keys:
    - `checkin.deniedExpiredTitle`: "Access denied"
    - `checkin.deniedExpiredBody`: "Your membership has expired.\nPlease see the front desk."
    - `checkin.seeFrontDesk`: "See front desk"
  - [x] Run `check-i18n-key-parity.mjs` before finishing.
- [x] **Task 5: pgTAP — extend `supabase/tests/check_in_one_open_session_enforcement.test.sql`** (AC #3)
  - [x] Do not create a new test file — this is still testing `check_in()`, matching Story 3.6's precedent of extending pre-existing test files for the same function/table rather than forking.
  - [x] Add `plans`/`subscriptions` fixtures (follow `manual_renewal_reset.test.sql`'s insert shape for both tables) for at least: a member with an `expired` subscription, a member with a `grace_period` subscription, and a member with zero subscription rows.
  - [x] Assert: the `expired` member's `check_in()` call is rejected (`throws_like`, matching the new exception message) and inserts **zero** `attendance_events` rows.
  - [x] Assert: the `grace_period` member's `check_in()` call still **succeeds** (`lives_ok`) — this is the explicit FR-031 regression guard (grace/expiring_soon must remain accepted).
  - [x] Assert: the zero-subscription member's `check_in()` call is also rejected (Scope Note #2's null-status decision).
  - [x] Bump `select plan(14)` to the new total assertion count.
- [x] **Task 6: Verification**
  - [x] `pnpm typecheck` and `node scripts/check-i18n-key-parity.mjs` (or this app's equivalent) pass.
  - [x] `supabase test db` passes (run from **WSL**, not native PowerShell — see Dev Notes).
  - [x] Manually/hands-on verify AC #1 still works unchanged (no regression) and AC #3's new red overlay renders, dismisses only on tap, and returns to Home — via direct RPC/SQL against the local instance if no device/simulator session is available (matches Stories 3.6/3.7's fallback).
  - [x] Confirm in Completion Notes that AC #2 (Success-Offline) was deliberately not implemented, per Scope Note #1.

### Review Findings

- [x] [Review][Patch] `deniedExpired` overlay never resets when the member returns to the Check-in tab — the screen is frozen on the red denial state for the rest of the session after the first denial, including after the member renews and comes back to try again [apps/mobile/src/app/(tabs)/checkin.tsx:221]
- [x] [Review][Patch] Missing pgTAP coverage for `expiring_soon` in the FR-031 regression guard — Task 5 explicitly requires "grace/expiring_soon must remain accepted" but only `grace_period` got a fixture and assertion [supabase/tests/check_in_one_open_session_enforcement.test.sql:256]
- [x] [Review][Patch] No test coverage for the realistic multi-subscription renewal scenario (a member with an old `expired` row plus a new `active` row), which is the scenario that actually exercises `order by created_at desc` [supabase/tests/check_in_one_open_session_enforcement.test.sql:282]
- [x] [Review][Patch] Assertion (h) only checks `lives_ok`, never confirms an `attendance_events` row was actually inserted for the grace_period member, unlike its sibling assertions (g)/(i) [supabase/tests/check_in_one_open_session_enforcement.test.sql:267]
- [x] [Review][Patch] Missing `reset role;` after assertion block (h), inconsistent with every other block in this file [supabase/tests/check_in_one_open_session_enforcement.test.sql:270]
- [x] [Review][Defer] No secondary tie-break (e.g. `id`) if two subscription rows share an identical `created_at` [supabase/migrations/0027_member_app_check_in_result_states.sql:457] — deferred, pre-existing: negligible practical risk given microsecond-precision timestamps, hardening item only
- [x] [Review][Defer] Subscription status is read without a lock before check-in completes — a narrow TOCTOU race against the periodic subscription-lifecycle batch job [supabase/migrations/0027_member_app_check_in_result_states.sql:457] — deferred, pre-existing: consistent with how the rest of the batch-updated subscription-status system already behaves
- [x] [Review][Defer] Client detects the `'expired'` outcome via substring-matching the raised exception's message rather than a stable error code [apps/mobile/src/services/checkin.ts:81] — deferred, pre-existing: matches this codebase's established convention for `already_checked_in`; a codebase-wide concern, not introduced by this story
- [x] [Review][Defer] The "most recent subscription row wins" business rule is implemented independently in both SQL (`check_in()`) and TS (Home screen) with no shared source of truth [supabase/migrations/0027_member_app_check_in_result_states.sql:457] — deferred, pre-existing: duplication predates this story

## Dev Notes

This story's real scope is much narrower than its three epics.md ACs suggest: AC #1 is already fully built (Story 3.4), and AC #2 cannot be built yet (it depends on infrastructure Story 3.9 owns). The only genuinely new work is AC #3 — and it requires a **backend change**, not just a UI overlay: `check_in()` currently has **zero** awareness of subscription status and will happily record a check-in for an expired member today. Read both Scope Notes below before writing any code.

### Scope Note #1 — AC #2 (Success-Offline) is out of scope for this story; do not build a stub for it

`apps/mobile/package.json` has no offline-detection or local-persistence library today (verified: no `netinfo`, `expo-network`, or `expo-sqlite` dependency exists anywhere in the mobile app). FR-061 ("Offline check-in only — recorded locally in SQLite, synced on reconnect...") is explicitly mapped to Story 3.9 ("Member App — Offline Check-In Queueing") in epics.md's own FR Coverage Map, and Story 3.9's ACs describe exactly this mechanism end-to-end. `checkin.tsx`'s own existing top-of-file comment (written during Story 3.4) already anticipated this split: *"Success - Offline is Story 3.9's job."*

Building a visual-only "syncing" overlay now — with nothing real to trigger it (no offline detection, no local queue) — would be dead UI that Story 3.9 has to wire up or rip out anyway. **Do not build any part of AC #2 in this story.** Leave the existing `success` overlay (online-only) exactly as it is.

### Scope Note #2 — `check_in()` has no subscription-status check today; this is this story's actual job

Verified by reading `supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql` in full: `check_in()` checks permission (`app_role = 'member'`), resolves the member, checks `deactivated_at`, then goes straight to the one-open-session lock/insert logic. It never reads `subscriptions` at all. Per FR-031 ("Two check-in outcomes for non-active members: accepted... for expiring_soon/grace_period; rejected... for expired"), this is a real, currently-unenforced gap — right now *any* member, including an expired one, can check in successfully.

Add the guard in a new migration (`0027`, `create or replace function check_in()`, redeclaring the full existing body per the `create or replace` precedent already established in this repo — e.g. `0019_member_onboarding_otp.sql`'s replacement of `private.protect_self_managed_user_columns()`). Insert it right after the existing `deactivated_at` check and before the `for update` lock — reject early, before doing any locking work, for a member who's going to be denied regardless:

```sql
declare
  v_status subscription_status;
  ...
begin
  ...
  if v_deactivated_at is not null then
    raise exception 'check_in: member is deactivated';
  end if;

  select status into v_status
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_status is null or v_status = 'expired' then
    raise exception 'check_in: member % subscription is expired', v_member_id;
  end if;

  select checkin_timeout_hours into v_timeout_hours from gyms where id = v_gym_id;
  ...
```

This query is the exact same "most recent subscription row for this member" pattern `(tabs)/index.tsx`'s Home screen already uses (`select status, expiry_date, plans(name) from subscriptions where member_id = ... order by created_at desc limit 1`) — there's no "current subscription" flag in the schema, recency is the only signal.

**No subscription row at all** (a member somehow reaching check-in with zero `subscriptions` rows — shouldn't happen in practice since onboarding's Plan Confirmation step always creates one, but defensively reachable the same way the existing `deactivated_at` check is defensive) is treated identically to `expired`: denied. There is no 6th UI state for "no plan" at check-in — FR-060 defines exactly five states, and "no plan" isn't one of them.

`expiring_soon` and `grace_period` must **not** be denied — only `null`/`expired` triggers the new guard. This is the FR-031 regression the pgTAP test in Task 5 must explicitly cover.

`checkin.tsx`'s own top-of-file comment currently misattributes this work to Epic 4 (*"Denied - Expired is Epic 4's job (subscription-status branching)"*) — that was written before epics.md finalized Story 3.8's scope. Correct it as part of Task 3; leaving it as-is would mislead the next reader of this file.

### Scope Note #3 — What this story explicitly does NOT touch

FR-049 ("A check-in event (accepted or rejected)... publishes a real-time alert... to all active dashboard sessions") is mapped to Epic 4 (Story 4.6, the real-time front-desk alert), not this story. `architecture.md` has no design today for how a *rejected* check-in gets modeled for that future consumer (no matches for "rejected"/"denied" anywhere in it) — that's Epic 4's design problem to solve when it's built, not something to scaffold speculatively now. This story's `check_in()` guard simply `raise exception`s with **no row inserted and no audit_log entry** — do not add a new table, column, or audit-log action type for a consumer that doesn't exist yet.

### Scope Note #4 — UI details for the new overlay

- Copy is fixed by both the UX mockup and the Voice-and-Tone microcopy table (`EXPERIENCE.md`, MA-10 section and the Voice and Tone table) — see Task 4's exact strings. French translations must match tone, not be literal (UX-DR14) — write them yourself, don't machine-translate.
- The button's behavior is the one meaningful UX difference from the two existing warning-style overlays (Already Checked In, Wrong QR): those call `resetScanning()` and return to the live scanning view; this one navigates back to Home (`router.navigate('/')`) per the UX mockup's "closes overlay, returns to MA-09" — a denied member shouldn't be invited to immediately rescan.
- `resultShowing` (the flag that suspends `onBarcodeScanned`, the nudge timer, and the idle pulse animation) must include this new state — otherwise the camera keeps trying to process scans underneath a full-screen overlay that's supposedly blocking entry.
- No new icon library, no haptics: UX-DR15 calls for a "notification-error" haptic on denial, but `expo-haptics` isn't installed anywhere in this app today (verified — zero references) and no prior story has introduced it. Adding it here would be an app-wide capability being bolted on for one screen; out of scope, consistent with how prior stories have left other pre-existing UX-DR gaps (e.g. skeleton loading states) unaddressed rather than fixing them piecemeal.

### Project Structure Notes

- New migration: `supabase/migrations/0027_member_app_check_in_result_states.sql` (next sequential number after Story 3.7's `0026`).
- Modified: `apps/mobile/src/services/checkin.ts` (new `'expired'` status), `apps/mobile/src/app/(tabs)/checkin.tsx` (new overlay + comment fix), `apps/mobile/src/locales/{en,fr}.json` (new `checkin.*` keys), `supabase/tests/check_in_one_open_session_enforcement.test.sql` (extended, not replaced).
- No new files under `apps/mobile/src/services/` — extend the existing `checkin.ts`, don't create a new module for three lines of branching logic.
- No new npm dependency (Scope Note #1 and #4 both explicitly rule out adding libraries in this story).

### Testing Standards Summary

- No mobile unit/component test runner exists in this repo — every prior mobile story has shipped without one; this story follows the same precedent (pgTAP for the RPC change, hands-on/manual verification for the screen).
- Run all `supabase`/Docker commands from **WSL**, not native PowerShell (project memory `project_supabase_wsl`) — if a live device/simulator session isn't reliably available in this environment, fall back to direct SQL/RPC verification against the local Postgres instance the same way Stories 3.6/3.7 did, and say so explicitly in Completion Notes.
- `check-i18n-key-parity.mjs` must pass after adding the new `checkin.*` keys to both locale files.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.8]
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md — FR-031, FR-049, FR-060, FR-061 (via epics.md's Requirements Inventory, which reproduces these FRs in full)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-10 (lines 613–713); Voice and Tone table (lines 208–228)]
- [Source: supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql — current `check_in()` body being amended]
- [Source: apps/mobile/src/app/(tabs)/checkin.tsx — current result-state UI and top-of-file scope comment]
- [Source: apps/mobile/src/app/(tabs)/index.tsx — subscription-status query pattern being reused, and the `#B3261E` error-red precedent]
- [Source: supabase/tests/manual_renewal_reset.test.sql — `plans`/`subscriptions` fixture insert shape]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `pnpm typecheck` — all 4 packages pass.
- `node scripts/check-i18n-key-parity.mjs` — all 4 locale pairs in parity (mobile: 116 keys).
- `supabase test db` (run from WSL per project convention) — required a `supabase db reset` first to pick up new migration 0027 (the running local instance had been started before this migration existed); after reset, `All tests successful. Files=21, Tests=329... Result: PASS`, including all 19 assertions in the extended `check_in_one_open_session_enforcement.test.sql`.

### Completion Notes List

- Implemented the only new work this story delivers: AC #3 (expired-member check-in denial). AC #1 (online success) was already built by Story 3.4 and is unchanged — its regression coverage is the pre-existing pgTAP assertions (a)/(b)/(c)/(f), which now pass with `active` subscription fixtures added (previously those test members had zero subscription rows, which would have failed under the new guard).
- **AC #2 (Success-Offline) was deliberately NOT implemented in this story**, per Scope Note #1 — it depends on offline-detection/local-persistence infrastructure owned by Story 3.9 (no `netinfo`/`expo-network`/`expo-sqlite` dependency exists in the mobile app today). The existing `success` (online-only) overlay was left untouched.
- Migration 0027 `create or replace function check_in()`, adding a subscription-status guard (null or `expired` → deny with `'check_in: member % subscription is expired'`) inserted after the existing `deactivated_at` check and before the open-session lock, per Scope Note #2's exact snippet. `expiring_soon`/`grace_period` remain accepted (FR-031 regression, explicitly asserted).
- No device/simulator session was available in this environment; AC #1/#3 verification was done via the pgTAP suite (direct RPC-level verification of `check_in()`'s new behavior) rather than hands-on device testing, matching Stories 3.6/3.7's documented fallback. The new `deniedExpired` overlay's rendering/dismiss-on-tap-only/navigate-to-Home behavior was verified by code review against the existing `alreadyCheckedIn`/`wrongQr` overlay patterns it mirrors, plus `pnpm typecheck` passing with no type errors on the new state/branch/render wiring.
- `supabase test db` initially failed 4/19 new assertions because the already-running local Postgres instance predated migration 0027 (`supabase test db` runs against whatever is already up, it does not itself apply new migrations) — a `supabase db reset` was required to pick it up. Verified via direct psql query against the container that the pre-reset `check_in()` function body was still the old (pre-0027) version before diagnosing this.

### File List

- `supabase/migrations/0027_member_app_check_in_result_states.sql` (new)
- `apps/mobile/src/services/checkin.ts` (modified — new `'expired'` status on `RecordCheckInResult`, new exception-message branch in `recordCheckIn()`)
- `apps/mobile/src/app/(tabs)/checkin.tsx` (modified — new `deniedExpired` state/overlay, `overlayDenied` style, top-of-file comment correction)
- `apps/mobile/src/locales/en.json` (modified — new `checkin.deniedExpiredTitle`/`deniedExpiredBody`/`seeFrontDesk` keys)
- `apps/mobile/src/locales/fr.json` (modified — same new keys, French copy)
- `supabase/tests/check_in_one_open_session_enforcement.test.sql` (modified — new `plans`/`subscriptions` fixtures including `active` subscriptions for pre-existing test members, 3 new members for expired/grace_period/zero-subscription cases, 5 new assertions, `plan(14)` → `plan(19)`)

## Change Log

- 2026-07-29: Implemented Story 3.8 — `check_in()` subscription-status guard (migration 0027) rejecting expired/no-subscription members (FR-031), new mobile "Access denied" full-screen result state (`deniedExpired`), new `checkin.*` i18n keys, extended pgTAP coverage. AC #2 (Success-Offline) deliberately deferred to Story 3.9 per Scope Note #1.
