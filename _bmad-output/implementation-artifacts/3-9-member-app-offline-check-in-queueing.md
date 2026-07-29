---
baseline_commit: 4f49b8044cb5440bca897aa7e96b49f1a3bbc40c
---

# Story 3.9: Member App — Offline Check-In Queueing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member without connectivity,
I want my check-in to still work,
so that a bad signal at the gym doesn't block my entry.

## Acceptance Criteria

1. **Given** no network connectivity, **when** I scan the gym QR, **then** the check-in is recorded locally in SQLite and a success state is shown immediately. [Source: epics.md#Story 3.9; FR-061; EXPERIENCE.md#MA-10 "Offline behavior" + "Success — Offline"]
2. **Given** connectivity resumes, **when** the queued check-in syncs, **then** it reaches the server; if the auto-timeout window has already passed, the server sets `checked_out_at` to `scan_time + timeout_duration`; the check-in event this produces is timestamped at sync time, not scan time (front-desk alerting on this event is Epic 4, Story 4.6's concern). [Source: epics.md#Story 3.9; FR-061] **See Scope Note #2 — "timestamped at sync time" describes when the row becomes visible to a future Realtime/alert consumer, not the value stored in `checked_in_at`, which must be the true scan time.**

## Tasks / Subtasks

- [x] **Task 1: Migration `0028` — offline-aware `check_in()` with idempotent sync** (AC #1, #2; Scope Notes #2, #3, #4)
  - [x] `supabase/migrations/0028_member_app_offline_check_in_queueing.sql`: add nullable `client_scan_id uuid` column to `attendance_events` + a partial unique index `where client_scan_id is not null` (idempotency key for retried syncs).
  - [x] `drop function if exists public.check_in();` then `create function public.check_in(p_scanned_at timestamptz default null, p_client_scan_id uuid default null) returns attendance_events` — **do not** use `create or replace` here; adding parameters changes the signature, so `create or replace` would silently create a second overloaded function instead of replacing the existing one (verified against Postgres's exact-signature-match rule for `CREATE OR REPLACE FUNCTION`). Re-issue `revoke execute ... from public` / `grant execute ... to authenticated` against the new signature (0023's original grant targets the old zero-arg signature and no longer applies once it's dropped).
  - [x] Reproduce the full 0027 function body, splicing in an idempotent-replay short-circuit **immediately after `v_member_id` is resolved and before the deactivated_at check** (ordering is load-bearing — see Scope Note #3), plus the offline-immediate-stale-close block after the existing insert. Everything else (deactivated check, subscription-status guard, `checkin_timeout_hours` lookup, the open-session lock/stale-close block) is unchanged.
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` (run from WSL against local Docker Postgres — the exact command every prior story in this repo uses, e.g. Story 1.6/1.11's precedent). This migration changes both a table shape (`attendance_events.client_scan_id`) and an RPC signature (`check_in`'s new params) — **do not assume a byte-identical diff** (that precedent only applies to RLS-only migrations, per Story 1.5/1.7/1.8); review the actual diff and confirm it adds exactly the new column and the new `check_in` `Args`/`Returns` shape.
- [x] **Task 2: Mobile — new dependencies** (AC #1, #2)
  - [x] `npx expo install expo-sqlite expo-network expo-crypto` from `apps/mobile` — all three are Expo-maintained packages, consistent with this app's existing dependency list (every current dependency is `expo-*`/`@expo/*`/React Native core/`@supabase/*`/`i18next` — no third-party community packages). **Read the exact versioned docs for all three at https://docs.expo.dev/versions/v57.0.0/ before writing code (per `apps/mobile/AGENTS.md`)** — API names below are believed correct as of this story's research but must be verified against the installed version.
- [x] **Task 3: Mobile — `apps/mobile/src/lib/sqlite.ts` (new)** (AC #1, #2)
  - [x] Local offline check-in queue: `openDatabaseAsync`, a single `offline_check_ins (id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL)` table created via `CREATE TABLE IF NOT EXISTS` on first open, and four functions: `insertOfflineCheckIn`, `getOfflineCheckIns` (ordered oldest-first by `scanned_at`), `deleteOfflineCheckIn`, `countOfflineCheckIns`. See Scope Note #1 for the full shape.
  - [x] This is the only file that imports `expo-sqlite` directly — matches this app's existing boundary discipline (`lib/supabase.ts` is the only file importing `@supabase/supabase-js` directly outside `services/`).
- [x] **Task 4: Mobile — `apps/mobile/src/services/checkin.ts`: queue + sync functions** (AC #1, #2; Scope Note #4)
  - [x] `queueOfflineCheckIn(): Promise<{ id: string; scannedAt: string }>` — generates a `client_scan_id` via `Crypto.randomUUID()` (`expo-crypto`), captures `new Date().toISOString()` as `scannedAt`, writes to SQLite via Task 3's `insertOfflineCheckIn`, returns immediately (no network call, no `await` on anything network-bound) — this is what makes AC #1's "success state is shown immediately" true.
  - [x] `syncPendingCheckIns(): Promise<void>` — reads all pending rows oldest-first, and for each calls `supabase.rpc('check_in', { p_scanned_at: record.scannedAt, p_client_scan_id: record.id })`. Per-record outcome handling (Scope Note #4): success → `deleteOfflineCheckIn`; error message includes `'already has an open check-in'` → leave queued (retried on the next sync pass); any other RPC error (expired, deactivated, permission denied, no member record) → `deleteOfflineCheckIn` anyway (can't be resolved by retrying — see Scope Note #4 for why this doesn't get a Sentry report); a thrown/network exception → leave queued, no deletion. One record's outcome must never stop processing the rest of the batch.
- [x] **Task 5: Mobile — `apps/mobile/src/lib/offline-sync-context.tsx` (new)** (AC #1, #2)
  - [x] Mirror the exact shape of the existing `lib/onboarding-context.tsx` (`createContext` + `XProvider` + `useX()` that throws if called outside the provider) — this app's established context pattern, don't introduce a new `contexts/` folder or a state library.
  - [x] `OfflineSyncProvider`: calls `expo-network`'s connectivity hook (`useNetworkState()` per current research — verify exact export name against the installed version's docs) once, exposing `isConnected` (treat `isConnected === false` as the only "confirmed offline" signal; anything else, including the hook's initial undetermined state, is treated as online — see Scope Note #5). Holds `pendingCount` state (from `countOfflineCheckIns()`), refreshed on mount and after every queue/sync mutation. One `useEffect` keyed on `[isConnected]` that calls `syncPendingCheckIns()` then refreshes `pendingCount` whenever `isConnected` is `true` — this single effect covers both "sync on reconnect" and "sync once on mount if already online," since React only re-fires it when the boolean's value actually changes or on initial mount.
  - [x] Exposes a wrapped `queueOfflineCheckIn` that calls the service function, refreshes `pendingCount`, and then opportunistically fires `syncPendingCheckIns()` again in case the connectivity flag was a stale false negative — cheap, and closes the gap where a brief signal blip is misread as "fully offline."
  - [x] `useOfflineSync()` returns `{ isConnected, pendingCount, queueOfflineCheckIn }`.
- [x] **Task 6: Mobile — wire the provider into `(tabs)/_layout.tsx`** (AC #1, #2)
  - [x] Wrap `<AppTabs />` in `<OfflineSyncProvider>`, matching exactly how `onboarding/_layout.tsx` wraps its `Stack` in `<OnboardingProgressProvider>`. Scoped to `(tabs)` (not the root layout) — the sync engine has no reason to run before a member is signed in and onboarded, matching this app's existing precedent of scoping context providers to the route group that needs them.
- [x] **Task 7: Mobile — `apps/mobile/src/app/(tabs)/checkin.tsx`: Success — Offline state** (AC #1; Scope Notes #2, #5)
  - [x] Add `successOffline` boolean state alongside `success`; include it in `resultShowing` (already covered since it's always set together with `success`) and reset it in `resetScanning()`.
  - [x] Call `const { isConnected, queueOfflineCheckIn } = useOfflineSync();` at the top of the component.
  - [x] At the top of `handleBarcodeScanned`, before calling `validateGymToken`: if `!isConnected`, branch immediately into a new `handleOfflineScan()` path — skip `validateGymToken` and `recordCheckIn` entirely (Scope Note #5: no wrong-QR / already-checked-in detection offline, by design).
  - [x] Also add the same `!isConnected` fallback inside the *existing* `error` branches of both `validateGymToken` and `recordCheckIn` (where `networkError`/`error` is set today) — a call that fails because the connectivity flag hadn't caught up yet should still fall through to the offline path rather than showing the generic network-error overlay.
  - [x] `handleOfflineScan()`: calls `queueOfflineCheckIn()`, then reuses the existing flash → success sequence (same `FLASH_DURATION_MS`/`SUCCESS_AUTO_DISMISS_MS` timers, same `mountedRef`/`isFocusedRef` guards as the online success path) but sets `successCheckedInAt` from the **returned `scannedAt`** (not a server response — there isn't one yet) and sets `successOffline = true` alongside `success = true`.
  - [x] In the `success` overlay's timestamp line, branch on `successOffline`: online renders `formatCheckInTime(successCheckedInAt, i18n.language)` (unchanged); offline renders `t('checkin.checkedInSyncing', { time: formatCheckInTime(successCheckedInAt, i18n.language) })` (new key, Task 9) — matching EXPERIENCE.md's `"08:14 AM · Syncing…"` mockup.
  - [x] Update the file's top-of-file doc comment — it currently attributes "Success - Offline is Story 3.9's job"; correct it now that this story implements it.
- [x] **Task 8: Mobile — `apps/mobile/src/app/(tabs)/index.tsx`: pending-sync banner** (AC #1, #2)
  - [x] `const { pendingCount } = useOfflineSync();`
  - [x] Render a banner when `pendingCount > 0`, placed directly below the existing `header` View (matches EXPERIENCE.md's "persistent banner below the header") — reuse this file's existing orange/amber token pair (`{ bg: '#FFEDD5', border: '#FED7AA', text: '#9A3412' }`, already used for `expiring_soon`/`grace_period`) rather than inventing new colors. Text: `t('home.offlineSyncPending')`.
  - [x] **Do not** build the separate, broader "You're offline — check-in still works." app-wide connectivity banner (EXPERIENCE.md line ~1738) in this story — see Scope Note #6.
- [x] **Task 9: i18n — new `checkin.*` and `home.*` keys** (AC #1)
  - [x] `apps/mobile/src/locales/en.json`: `checkin.checkedInSyncing`: `"{{time}} · Syncing…"`; `home.offlineSyncPending`: `"Offline check-in pending sync…"` (both copied verbatim from EXPERIENCE.md).
  - [x] `apps/mobile/src/locales/fr.json`: `checkin.checkedInSyncing`: `"{{time}} · Synchronisation en cours…"`; `home.offlineSyncPending`: `"Enregistrement hors ligne en attente de synchronisation…"` — drafted to match this file's existing tone (`checkin.checkedIn`: "Enregistré", `home.errorLoadFailed`'s "Vérifiez votre connexion" phrasing); review/adjust wording, don't machine-translate blindly (UX-DR14).
  - [x] Run `node scripts/check-i18n-key-parity.mjs` before finishing.
- [x] **Task 10: pgTAP — extend `supabase/tests/check_in_one_open_session_enforcement.test.sql`** (AC #2)
  - [x] Do not create a new test file — same file that already tests `check_in()`, per Story 3.6/3.8's precedent of extending rather than forking.
  - [x] Assert the existing zero-arg assertions (a)–(j) still pass unchanged — they exercise `check_in()` with no arguments, which must behave identically to before now that the function has been dropped and recreated with two defaulted parameters.
  - [x] New assertions, using the same fixture-insert conventions already in this file (gym `...9011`, tier `...9001`):
    - A member with an `active` subscription: call `check_in(p_scanned_at => now() - interval '2 hours', p_client_scan_id => <uuid>)` where the gym's `checkin_timeout_hours` (8, default) has **not** elapsed since `p_scanned_at` → row inserted, `checked_in_at` equals the passed `p_scanned_at`, `checked_out_at` is still null.
    - Same member/setup but `p_scanned_at => now() - interval '10 hours'` (past the 8h timeout) → row inserted, `checked_out_at` equals `p_scanned_at + 8 hours`, `checkout_type = 'auto'`.
    - Idempotent replay: call `check_in()` twice with the **same** `p_client_scan_id`, **without closing the session in between** (this is the important case — it must succeed even though the member still has an open check-in from the first call, which is exactly the scenario the lock block would otherwise wrongly reject) → second call returns the same row (`id` matches), and `attendance_events` has exactly one row for that `client_scan_id` (`count(*) = 1`).
    - An `expired`-subscription member's offline-sync call (`p_scanned_at` provided) is still rejected the same way the existing online-path assertion (g) expects — confirms Scope Note #3's guard placement (before the insert) applies identically to both call shapes.
    - Bump `select plan(24)` to the new total.
  - [x] `reset role;` after every assertion block, matching this file's existing convention (a gap the Story 3.8 review already flagged once — don't repeat it).
- [x] **Task 11: Verification**
  - [x] `pnpm typecheck` (all 4 packages) and `node scripts/check-i18n-key-parity.mjs` pass.
  - [x] `supabase test db`, run from **WSL**, not native PowerShell (project memory `project_supabase_wsl`) — **run `supabase db reset` first** if a local instance was already running before this migration existed (Story 3.8's Completion Notes hit exactly this: `supabase test db` runs against whatever is already up, it does not apply new migrations itself).
  - [x] Manually verify AC #1: put the device/simulator in airplane mode, scan the gym QR, confirm the green "Syncing…" overlay appears immediately with no network wait, then confirm the pending-sync banner appears on Home. Re-enable connectivity and confirm the banner disappears and the check-in appears in Recent Activity. If no device/simulator session is available in this environment, verify via direct RPC calls against the local Postgres instance (`select * from check_in(now() - interval '10 hours', gen_random_uuid());` under a simulated member session) the same way Stories 3.6–3.8 documented as their fallback — say so explicitly in Completion Notes.

### Review Findings

- [x] [Review][Defer] `syncPendingCheckIns` deletes queued check-ins on any non-"already open" RPC error, including transient failures [apps/mobile/src/services/checkin.ts] — deferred, user decision: leave as-is. A transient server-side error (statement timeout, deadlock, temporary outage) is returned as a normal `{error}` response, not a thrown exception, so it falls into the "delete anyway" bucket even though it may have succeeded on retry; accepted as rare/low-impact at pilot scale rather than adding a maintained permanent-error whitelist.
- [x] [Review][Defer] No de-duplication for repeated offline scans within the same outage [apps/mobile/src/app/(tabs)/checkin.tsx] — deferred, user decision: leave as-is. A second re-scan queues a second `client_scan_id`; on reconnect the first syncs, the second legitimately hits "already has an open check-in" and stays queued until checkout or the timeout job fires, then replays into a second, spurious attendance event for one physical visit — rare (requires a deliberate re-scan) and low-stakes (attendance data, not billing).
- [x] [Review][Defer] Migration 0028's `create unique index` on `attendance_events` is not built `CONCURRENTLY` [supabase/migrations/0028_member_app_offline_check_in_queueing.sql] — deferred, user decision: leave as-is. Takes an ACCESS EXCLUSIVE lock on `attendance_events` for the duration of the index build; matches this repo's own established precedent (`idx_gyms_name_unique`, story 1-5, deferred for the identical reason at identical pilot scale).
- [x] [Review][Patch] `handleOfflineScan` has no error handling around the SQLite write — `queueOfflineCheckIn()` is awaited with no try/catch in both `handleOfflineScan` and its caller; if `insertOfflineCheckIn` throws, the rejection is unhandled, `setValidating(false)` is never reached, and `processingRef.current` stays `true` forever, freezing the scan screen for that session. [apps/mobile/src/app/(tabs)/checkin.tsx:189-199]
- [x] [Review][Patch] `syncPendingCheckIns` can reject before any per-record handling runs — If the initial `getOfflineCheckIns()` read throws, the whole function rejects; neither the reconnect `useEffect` nor the opportunistic call in `offline-sync-context.tsx` catches it, so `pendingCount` is never refreshed after the failure. [apps/mobile/src/services/checkin.ts:116; apps/mobile/src/lib/offline-sync-context.tsx:43-57]
- [x] [Review][Patch] `sqlite.ts`'s `getDb()` caches a rejected promise on first-open failure — If `openDatabaseAsync` or the initial `CREATE TABLE` rejects on the first call, the cached promise stays rejected, permanently breaking every subsequent insert/get/delete/count call for the rest of the app session. [apps/mobile/src/lib/sqlite.ts:19-29]
- [x] [Review][Patch] Two independent triggers can invoke `syncPendingCheckIns()` concurrently with no guard — The reconnect `useEffect` (keyed on `isConnected`) and the opportunistic call inside the wrapped `queueOfflineCheckIn` can fire close together, both reading and processing the same pending rows, causing avoidable duplicate RPC calls on reconnect. [apps/mobile/src/lib/offline-sync-context.tsx:43-57]
- [x] [Review][Patch] Swallowed exceptions in `syncPendingCheckIns` have zero logging — The `catch { }` block around the per-record RPC call eats every network/thrown exception silently, with no `console.error` even for local dev/QA visibility into why a record is stuck. [apps/mobile/src/services/checkin.ts]
- [x] [Review][Defer] Sync-outcome branching depends on a hardcoded substring match on the Postgres exception message [apps/mobile/src/services/checkin.ts] — deferred, pre-existing design choice specified by Task 4/Scope Note #4; fragile if the server message wording ever changes, but not a regression introduced by this diff.
- [x] [Review][Defer] Pending-sync banner text isn't pluralization-aware for `pendingCount > 1` [apps/mobile/src/locales/en.json, fr.json] — deferred, text is copied verbatim from EXPERIENCE.md per Task 9's explicit instruction; a design-level wording change, not a code defect.
- [x] [Review][Defer] Device clock is trusted for `checked_in_at`; only future skew is clamped, not past skew [supabase/migrations/0028_member_app_offline_check_in_queueing.sql] — deferred, this is Scope Note #2's own disambiguation of what gets clamped; not an implementation gap introduced by this diff.
- [x] [Review][Defer] No accessibility live-region announcement for the offline banner / "Syncing…" text [apps/mobile/src/app/(tabs)/checkin.tsx, index.tsx] — deferred, consistent with the rest of this app's existing lack of accessibility props; a pre-existing gap, not unique to this change.
- [x] [Review][Defer] `client_scan_id` collision with a different member's row would surface as a raw unique-violation and get silently deleted from the queue on next sync [supabase/migrations/0028_member_app_offline_check_in_queueing.sql] — deferred, extremely low likelihood given UUIDv4 generation via `Crypto.randomUUID()`, but a real unhandled path worth a follow-up.

## Dev Notes

This story adds the one piece of client-side persistence this codebase has avoided everywhere else (NFR-006: "member app supports offline QR check-in only; other flows do not require or support offline operation") — read all six Scope Notes below before writing code; several make load-bearing design decisions the epics.md ACs don't spell out.

### Scope Note #1 — SQLite schema is intentionally minimal

`apps/mobile/src/lib/sqlite.ts` is a new file, but the shape it owns is tiny — one table, no relations, no migrations of its own:

```sql
CREATE TABLE IF NOT EXISTS offline_check_ins (
  id TEXT PRIMARY KEY,      -- client_scan_id (uuid string) -- doubles as the server-side idempotency key
  scanned_at TEXT NOT NULL  -- ISO 8601, captured at scan time on-device
);
```

No `synced` flag, no retry-count column — a row's mere presence in this table *is* "pending sync"; a successful sync deletes it. This matches the architecture doc's own scoping of `expo-sqlite` ("scoped only to the offline check-in queue (FR-061) — no client-side cache library") and this app's existing preference for the smallest schema that satisfies the AC, not a general-purpose offline-mutation-queue abstraction.

### Scope Note #2 — `checked_in_at` = scan time; "timestamped at sync time" is about Realtime visibility, not this column

Read epics.md's AC #2 literally and you might set `checked_in_at` to the sync-time `now()`. That is wrong. Cross-reference FR-061 directly: *"if sync lands after the auto-timeout window, server closes it at `scan_time + timeout_duration`"* — this arithmetic only works if `checked_in_at` holds the **true scan time**, not the sync time (`scan_time + timeout_duration` computed against a sync-time `checked_in_at` would place `checked_out_at` in the future relative to when the row was even created, or produce a checkout time earlier than the checkin time — nonsensical). FR-061's own next clause, *"alert fires at sync time, not scan time,"* is about the **future front-desk alert** (Epic 4, Story 4.6) — that alert's realtime trigger fires off the moment the `INSERT` actually happens (sync time), which is simply a natural property of when the row starts existing, not something this story implements or needs to fake. `checked_in_at` must be the real scan moment; the row's *existence* (and therefore anything that reacts to its insertion) naturally happens at sync time. Both statements are true simultaneously without contradiction once you separate "value of a column" from "moment a row is created."

One added defensive guard beyond epics.md's literal AC: clamp `p_scanned_at` to `now()` if it's in the future (device clock skew) — `attendance_events.checked_in_at` is a real record other features (occupancy, history) read; a corrupted future-dated row from a wrong device clock is worse than silently treating it as "now."

### Scope Note #3 — Migration 0028's exact `check_in()` design

**Why `drop` + `create` instead of `create or replace`:** Postgres's `CREATE OR REPLACE FUNCTION` requires the argument list to match the existing function's signature exactly to replace it in place. `check_in()` (zero args, from 0023, amended by 0027) and a hypothetical `check_in(p_scanned_at timestamptz default null, p_client_scan_id uuid default null)` are **different signatures** — `create or replace` would silently create a second, overloaded function alongside the original rather than replacing it, leaving two versions of the guard logic to drift out of sync. `drop function if exists public.check_in();` first avoids that trap entirely — there is exactly one `check_in` function before and after this migration.

**Full function, existing logic unchanged except for one inserted short-circuit block and the tail:**

```sql
create function public.check_in(p_scanned_at timestamptz default null, p_client_scan_id uuid default null)
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_status subscription_status;
  v_timeout_hours integer;
  v_open_id uuid;
  v_open_checked_in_at timestamptz;
  v_checked_in_at timestamptz;
  v_row attendance_events;
begin
  -- >>> unchanged from 0027: permission check, v_gym_id resolution, <<<
  -- >>> v_member_id/v_deactivated_at resolution. <<<

  -- NEW, inserted here -- immediately after v_member_id is resolved, BEFORE
  -- the deactivated_at check, the subscription-status guard, and (critically)
  -- BEFORE the open-session lock block below. This ordering is load-bearing:
  -- if a sync retry (app killed after the server insert but before the
  -- local queue delete) reached the open-session lock block first, it would
  -- see ITS OWN prior successful insert as a blocking "already open"
  -- session and reject the replay with 'already has an open check-in' --
  -- permanently, since retrying can never resolve a block caused by the
  -- retry's own earlier success. Short-circuiting here, before that block
  -- ever runs, avoids the trap entirely. The member_id match is a
  -- defense-in-depth ownership check (client_scan_id is a client-generated
  -- random UUID scoped to one member's one scan; this just guarantees a
  -- SECURITY DEFINER function can never hand back a different member's row
  -- even in a contrived collision).
  if p_client_scan_id is not null then
    select * into v_row from attendance_events
    where client_scan_id = p_client_scan_id and member_id = v_member_id;
    if v_row.id is not null then
      return v_row;
    end if;
  end if;

  -- >>> unchanged from 0027: deactivated_at check, subscription-status <<<
  -- >>> guard, checkin_timeout_hours lookup, the "for update" open-session <<<
  -- >>> lock and its stale-auto-close branch. <<<

  -- Clamp a future-dated client scan (clock skew) to now(); Scope Note #2.
  v_checked_in_at := coalesce(p_scanned_at, now());
  if v_checked_in_at > now() then
    v_checked_in_at := now();
  end if;

  insert into attendance_events (gym_id, member_id, checked_in_at, client_scan_id)
  values (v_gym_id, v_member_id, v_checked_in_at, p_client_scan_id)
  returning * into v_row;
  -- No ON CONFLICT needed -- the short-circuit above already handles the
  -- ordinary replay case. The partial unique index on client_scan_id (added
  -- earlier in this migration) still stands as a backstop against a true
  -- concurrency race (two simultaneous sync attempts for the same queued
  -- record); a 23505 in that narrow window surfaces as an ordinary RPC
  -- error, which the client's sync loop already treats as "leave queued,
  -- retry later" -- the next retry resolves cleanly via the short-circuit.

  -- Offline-sync immediate-stale case (AC #2): only reachable for a freshly
  -- inserted row -- the replay path above already returned earlier.
  if p_scanned_at is not null and v_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
    update attendance_events
    set checked_out_at = v_checked_in_at + make_interval(hours => v_timeout_hours),
        checkout_type = 'auto'
    where id = v_row.id
    returning * into v_row;

    perform log_audit_event(
      p_action_type => 'attendance_stale_check_in_auto_closed',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_row.id::text,
      p_target_entity_type => 'attendance_event',
      p_metadata => jsonb_build_object(
        'member_id', v_member_id,
        'original_checked_in_at', v_checked_in_at,
        'auto_closed_checked_out_at', v_row.checked_out_at,
        'timeout_hours', v_timeout_hours,
        'source', 'offline_sync'
      )
    );
  end if;

  return v_row;
end;
$$;

revoke execute on function public.check_in(timestamptz, uuid) from public;
grant execute on function public.check_in(timestamptz, uuid) to authenticated;
```

The pre-existing "is there *already* a different open session" lock block (checking `now()` against a **prior** row's staleness) is untouched and still runs — for a genuinely new scan (not a replay) it behaves exactly as it does today. It only gets bypassed on the replay path because that path returns before ever reaching it, which is the entire point.

### Scope Note #4 — Per-record sync failure handling; no Sentry (not integrated in mobile yet)

Three outcomes per queued record, oldest-first, each independent:
- **Success** → delete from the local queue.
- **`'already has an open check-in'`** → leave it queued. This is recoverable: either the pre-existing open session gets auto-closed by the next scan/cron pass (Story 3.5), or the member manually checks out — either way, a later sync pass will succeed. Don't build retry-count/backoff logic for this; the existing connectivity-triggered sync effect already retries on every reconnect.
- **Anything else** (expired subscription, deactivated, permission denied, no member record) → delete from the queue anyway. Retrying can't fix these — the member's state has to change first, and there's no mechanism today (and no AC in this story) for surfacing "your offline check-in silently didn't count" back to the member. This is a genuine, acknowledged gap, not an oversight: `grep`ing this app confirms `Sentry`/`@sentry` has zero references anywhere despite NFR-007 — there is no crash/error reporting pipeline to report into. Wiring up Sentry for the whole app is out of scope for this story (same category of pre-existing gap Story 3.8's Scope Note #4 left `expo-haptics` in).

### Scope Note #5 — No offline "already checked in" or "wrong QR" detection; `isConnected` truthiness rule

EXPERIENCE.md's "Offline behavior" bullet list for MA-10 describes exactly one flow: *"Camera and QR decoding work fully offline... On scan: check-in recorded to local SQLite immediately; show success result with sync indicator."* It does not describe an offline wrong-QR or offline already-checked-in state, and epics.md's Story 3.9 ACs only cover two scenarios (record + sync). This is a deliberate scope boundary, not a gap: `validateGymToken()`'s QR-token comparison has **never** been a security check even online — `check_in()` (both before and after this story) determines which gym to check into purely from `private.gym_id()` (the caller's JWT claim), completely independent of the scanned token's content. The online "wrong QR" flow exists only as a friendly "you scanned the wrong sign" nudge. Skipping it offline (where the comparison is impossible anyway, with no cached gym token to compare against) extends the exact same trust level the RPC already grants — it does not weaken any actual authorization boundary. Do not add a gym-token caching mechanism to make offline QR "validation" possible; it would be solving a problem that doesn't exist.

`isConnected` truthiness: treat `isConnected === false` as the only confirmed-offline signal. `expo-network`'s connectivity hook can report an undetermined/loading state before its first real read completes; treating that as "online" (attempt the normal path, let the existing error-branch fallback in Task 7 catch a genuine false-negative) is safer than treating "unknown" as "offline" and needlessly queueing scans that could have gone through the deferred network path.

### Scope Note #6 — The general "You're offline" app-wide banner is explicitly OUT of scope

EXPERIENCE.md documents two *different* banners. The one this story builds (Home screen, "Offline sync banner": *"If a check-in is queued for sync: persistent banner below the header — 'Offline check-in pending sync…'"*) is queue-state-driven and directly tied to this story's own feature. The other — *"Network unavailable — Member App: Persistent amber banner below branded header: 'You're offline — check-in still works.' Hides when connectivity returns"* — is a general, app-wide connectivity indicator unrelated to whether anything is actually queued, isn't mapped to any FR in Story 3.9's coverage (FR-061 only), and isn't one of this story's two ACs. Building it now would be scope creep matching the exact anti-pattern Story 3.8's Scope Note #1 called out ("dead UI... that this story has to wire up or rip out anyway" — except inverted, since here it'd be *extra* UI nobody asked this story for). Leave it for whichever future story actually owns app-wide connectivity messaging.

### Project Structure Notes

- New migration: `supabase/migrations/0028_member_app_offline_check_in_queueing.sql` (next sequential number after Story 3.8's `0027`).
- New: `apps/mobile/src/lib/sqlite.ts`, `apps/mobile/src/lib/offline-sync-context.tsx`.
- Modified: `apps/mobile/src/services/checkin.ts` (new `queueOfflineCheckIn`/`syncPendingCheckIns`), `apps/mobile/src/app/(tabs)/checkin.tsx` (offline branch + Success-Offline overlay text), `apps/mobile/src/app/(tabs)/index.tsx` (pending-sync banner), `apps/mobile/src/app/(tabs)/_layout.tsx` (mount `OfflineSyncProvider`), `apps/mobile/src/locales/{en,fr}.json`, `apps/mobile/package.json` (+3 deps), `packages/types/src/database.ts` (regenerated), `supabase/tests/check_in_one_open_session_enforcement.test.sql`.
- No new top-level folders: the new context file goes in the existing `lib/` (matching `lib/onboarding-context.tsx`'s precedent), not a new `contexts/` directory.
- `apps/mobile/src/lib/sqlite.ts` is the *only* file that imports `expo-sqlite` directly, matching this app's existing "one file owns the low-level client" boundary discipline (`lib/supabase.ts` for `@supabase/supabase-js`).

### Testing Standards Summary

- No mobile unit/component test runner exists in this repo (unchanged from Story 3.8's note) — pgTAP for the RPC change, hands-on/manual (airplane-mode) verification for the screen, with the same direct-RPC fallback Stories 3.6–3.8 used when no device/simulator session is available.
- Run all `supabase`/Docker commands from **WSL**, not native PowerShell (project memory `project_supabase_wsl`).
- `check-i18n-key-parity.mjs` must pass after adding the new `checkin.*`/`home.*` keys to both locale files.
- **If a local Supabase instance is already running when this migration is added, `supabase test db` will not pick it up on its own** — run `supabase db reset` first (exact issue Story 3.8's Completion Notes hit and documented).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.9]
- [Source: _bmad-output/planning-artifacts/epics.md — FR-061, NFR-006 (via epics.md's Requirements Inventory)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-09 "Offline sync banner" (lines 601–602); #MA-10 "Offline behavior" + "Success — Offline" (lines 654–677); "Network unavailable — Member App" (lines 1738–1739, explicitly out of scope per Scope Note #6)]
- [Source: _bmad-output/planning-artifacts/architecture.md — "Mobile state/data" section: "SQLite (`expo-sqlite`) scoped only to the offline check-in queue (FR-061)"; Project Structure's `apps/mobile/lib/ (supabase.ts, sqlite.ts, errors.ts)` — `sqlite.ts` was already anticipated as a file this story would create]
- [Source: supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql; 0027_member_app_check_in_result_states.sql — current `check_in()` body being replaced]
- [Source: apps/mobile/src/services/checkin.ts; apps/mobile/src/app/(tabs)/checkin.tsx — existing online check-in flow, result-state overlay conventions]
- [Source: apps/mobile/src/app/(tabs)/index.tsx — Home screen load pattern, existing orange/amber status-color tokens reused for the new banner]
- [Source: apps/mobile/src/lib/onboarding-context.tsx; apps/mobile/src/app/onboarding/_layout.tsx — this app's established Context-provider pattern being mirrored]
- [Source: _bmad-output/implementation-artifacts/3-8-member-app-check-in-result-states.md — Scope Note #1 ("Success - Offline is Story 3.9's job," confirms no offline infra exists yet as of 3.8), Completion Notes (the `supabase db reset` gotcha)]
- [Source: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/ — `openDatabaseAsync`/`runAsync`/`getAllAsync` API shape, fetched 2026-07-29]
- [Source: https://docs.expo.dev/versions/v57.0.0/sdk/network/ — connectivity hook/listener, fetched 2026-07-29]
- [Source: https://docs.expo.dev/versions/v57.0.0/sdk/crypto/ — `Crypto.randomUUID()`, fetched 2026-07-29]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` + `supabase test db` (run from WSL against local Docker Postgres, per project memory `project_supabase_wsl`): all 21 test files / 344 assertions pass after two fixes surfaced during the first run:
  1. The new offline-sync pgTAP fixtures (4 new Gym A members) pushed Gym A past its test tier's `member_cap` of 10 — bumped the tier's `member_cap` to 20 in the fixture.
  2. `check_out_manual_auto_timeout.test.sql` assertion 21 ("exactly one success row is written to job_runs") failed once with `have: 2, want: 1` — this is pre-existing pg_cron timing flakiness (the real `check_in_auto_timeout` cron job fires on its own schedule against the local instance; if it fires between `db reset` and the test run, the count is 2). Confirmed unrelated to this story (no changes touch that migration/test); a fresh `db reset` immediately before `test db` made it pass. Not something this story's scope can fix.
- `pnpm typecheck` (all 4 packages): pass.
- `node scripts/check-i18n-key-parity.mjs`: pass (118 keys, en/fr in parity).
- No mobile device/simulator session available in this environment (same limitation as Stories 3.6–3.8) — AC #1 and AC #2 were verified via direct RPC calls against the local Postgres instance under simulated member sessions (`set local role authenticated` + `set_config('request.jwt.claims', ...)`), matching the fallback those stories documented:
  - AC #1: `check_in(now() - interval '30 minutes', gen_random_uuid())` → row inserted immediately, `checked_in_at` equals the passed scan time, `checked_out_at` null.
  - AC #2: `check_in(now() - interval '10 hours', gen_random_uuid())` (past the 8h default timeout) → row inserted, `checked_out_at` = `checked_in_at + 8 hours` exactly, `checkout_type = 'auto'`.
  - Idempotent replay: calling `check_in()` twice with the same `client_scan_id` (member still has the open session from the first call) → both calls return the identical row id, exactly one `attendance_events` row exists for that `client_scan_id`.

### Completion Notes List

- Migration `0028` drops and recreates `check_in()` with two new defaulted params (`p_scanned_at`, `p_client_scan_id`) rather than `create or replace`, since the signature changed (Scope Note #3). The idempotent-replay short-circuit runs before the deactivated/subscription/open-session-lock guards, exactly as specified, so a sync retry can never be blocked by its own prior success.
- `packages/types/src/database.ts` was regenerated via `supabase gen types typescript --local`. The diff is larger than just `client_scan_id`/`check_in`'s new signature: it also picks up several RPCs (`check_out`, `check_out_member`, `renew_subscription`, `run_check_in_auto_timeout_job`, `run_subscription_lifecycle_job`, `member_occupancy_band`, `super_admin_job_failures`) and the `gyms.checkin_timeout_hours` column that were added by Stories 3.1–3.6 but never picked up — `git log` shows `database.ts` was last regenerated in Story 2.7, before any of those migrations existed. This is pre-existing drift, not something introduced by this story; running the documented regen command is the correct fix rather than hand-trimming the diff to only this story's own change.
- No mobile unit/component test runner exists in this repo (unchanged from Story 3.8) — verification relied on pgTAP for the RPC and the direct-RPC fallback above for the mobile screen behavior, since no device/simulator session was available.

### File List

- `supabase/migrations/0028_member_app_offline_check_in_queueing.sql` (new)
- `packages/types/src/database.ts` (regenerated)
- `supabase/tests/check_in_one_open_session_enforcement.test.sql` (extended: new offline-sync fixtures/assertions, `member_cap` bump, `plan(24)` → `plan(34)`)
- `apps/mobile/src/lib/sqlite.ts` (new)
- `apps/mobile/src/lib/offline-sync-context.tsx` (new)
- `apps/mobile/src/services/checkin.ts` (modified: `queueOfflineCheckIn`, `syncPendingCheckIns`)
- `apps/mobile/src/app/(tabs)/checkin.tsx` (modified: offline branch, Success — Offline overlay, shared `showSuccessOverlay`)
- `apps/mobile/src/app/(tabs)/index.tsx` (modified: pending-sync banner)
- `apps/mobile/src/app/(tabs)/_layout.tsx` (modified: mount `OfflineSyncProvider`)
- `apps/mobile/src/locales/en.json` (modified: `checkin.checkedInSyncing`, `home.offlineSyncPending`)
- `apps/mobile/src/locales/fr.json` (modified: `checkin.checkedInSyncing`, `home.offlineSyncPending`)
- `apps/mobile/package.json` (modified: +`expo-sqlite`, `expo-network`, `expo-crypto`)
- `apps/mobile/app.json` (modified: `expo-sqlite` config plugin, added automatically by `expo install`)
- `pnpm-lock.yaml` (modified: new dependency lockfile entries)

## Change Log

- 2026-07-29: Implemented Story 3.9 — offline check-in queueing (FR-061). Migration `0028` adds `attendance_events.client_scan_id` and an idempotency-aware `check_in(p_scanned_at, p_client_scan_id)` RPC; mobile gets a new SQLite-backed offline queue (`lib/sqlite.ts`), sync engine (`lib/offline-sync-context.tsx`, `services/checkin.ts`), a Success — Offline result state on the check-in screen, and a Home-screen pending-sync banner. Extended pgTAP coverage for the offline-sync RPC path (not-stale, past-timeout, idempotent replay, expired-subscription rejection).
