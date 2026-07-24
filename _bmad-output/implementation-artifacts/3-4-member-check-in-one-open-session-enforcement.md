---
baseline_commit: fd074bee858a525a77d7ff03501d2a20fee6423a
---

# Story 3.4: Member Check-In & One-Open-Session Enforcement

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want to check in by scanning my gym's QR code,
so that my visit is recorded without paperwork.

## Acceptance Criteria

1. **Given** a valid gym QR scan and no open check-in for this member, **when** the scan completes, **then** an attendance event is recorded and a success confirmation is shown. [Source: epics.md#Story 3.4]
2. **Given** a member already has an open check-in, **when** they scan again, **then** the second scan is rejected with "You're already checked in," enforced via a partial unique index. [Source: epics.md#Story 3.4]
3. **Given** a member has a stale open check-in (e.g., from an app crash), **when** they scan again, **then** the system auto-closes the stale check-in at `original_check_in_time + timeout_duration`, records the new check-in, and logs the auto-close to the audit log. [Source: epics.md#Story 3.4]

## Scope Notes — Read Before the Tasks

**This story closes the exact gap Story 3.3 deliberately left open.** Read all five notes below before writing any code.

### Scope Note #1 — Where this picks up from Story 3.3

`apps/mobile/src/app/(tabs)/checkin.tsx`'s `handleBarcodeScanned` currently does, on a matching token: a brief corner-bracket flash (`FLASH_DURATION_MS`), then resets `processingRef` and resumes scanning — **no result overlay**. That file's own doc comment says explicitly: *"Success / Already Checked In are Story 3.4's job... See the story's Scope Note #2"* (3-3 story file, Scope Note #2). `validateGymToken()` (`apps/mobile/src/services/checkin.ts`) is unchanged by this story — it still only answers "does this scanned token belong to my own gym." This story adds a **second** call, made only after a token match, that actually records the attendance event and tells the screen which of two outcomes to render. Do not modify `validateGymToken()`'s signature or the Wrong-QR/network-error branches — they stay exactly as 3.3 built them.

Also unchanged: `0006_attendance.sql`'s own comment anticipates this story by name: *"The partial unique index enforcing 'one open check-in per member' (FR-044) is Epic 3's concern once check-in flows actually exist — not added here."* This story is that "once."

### Scope Note #2 — New Postgres objects: one migration, no RLS policy widening

This story needs one new migration (next number: **`0023`**, following `0021`/`0022`'s established flat, unprefixed naming). It adds three things to `attendance_events`/`gyms`, and reuses `log_audit_event()` (0007) — no new tables.

**(a) The partial unique index** (AC #2's literal enforcement mechanism):
```sql
create unique index idx_attendance_events_one_open_per_member
  on attendance_events (member_id)
  where checked_out_at is null;
```

**(b) A new `gyms.checkin_timeout_hours` column** — required for AC #3's `original_check_in_time + timeout_duration` math, and shared with Story 3.5's cron-based auto-timeout (FR-045's *"configurable per gym... default 8 hours"* is the same setting both stories use). No column for this exists today — it was not part of `gyms`' original Story-1.3 column set (unlike `grace_period_days`/`capacity`/`alert_auto_dismiss_minutes`, which were). Add it here since this story is the first to need the value:
```sql
alter table gyms add column checkin_timeout_hours integer not null default 8;
```
**Do not add a Settings-page UI field for this column in this story.** `gym-settings.ts`/`SettingsForm.tsx`/`packages/types/src/schemas/gym.ts` are not touched. FR-045 (*"configurable per gym in Settings"*) is Story 3.5's FR, not this story's — this story only needs the column to exist with a sensible default so its own stale-check-in math works. Exposing it as an editable Settings field is Story 3.5's job, matching this story's own AC wording (neither AC #1–#3 mentions Settings at all) and the established precedent from Stories 3.1/3.2 of shipping backend-only work with no speculative UI.

**(c) A new `check_in()` RPC** — a `SECURITY DEFINER` Postgres function, following `renew_subscription()`'s exact established shape (0022, Story 3.2 Scope Note #5) rather than a raw RLS-gated INSERT. The three-step "check for an open session → auto-close if stale → insert" sequence must be atomic (a client doing this as three separate Supabase calls would have a race window), which is exactly the kind of multi-step invariant this codebase already solves with a `SECURITY DEFINER` function rather than RLS-policy composition.

Unlike `renew_subscription()` (staff acting on another member, hence the role-array self-check), `check_in()` is **member self-service** acting only on the caller's own row — no `p_member_id` parameter; the member and gym are derived entirely from the caller's own session (`auth.uid()` / `private.gym_id()`), matching `0019`/`0020`'s self-service member functions' pattern of deriving identity from the session rather than trusting a caller-supplied id. It does **not** need a scanned-token parameter either: `validateGymToken()` (3.3, Scope Note #3) already established that in V1 (one gym per JWT, no multi-gym switcher) a matching token can only ever mean "this member's own gym" — so once the mobile screen has a match, the gym for the check-in is unambiguously `private.gym_id()`.

```sql
create function check_in()
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_timeout_hours integer;
  v_open_id uuid;
  v_open_checked_in_at timestamptz;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id;

  if v_member_id is null then
    raise exception 'check_in: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring renew_subscription()'s deactivated_at guard
  -- (0022): the mobile root-layout session gate (use-session.ts) already
  -- excludes deactivated members from ever reaching this screen in the app
  -- UI, but this function is reachable by any holder of a valid session
  -- token, not just through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'check_in: member is deactivated';
  end if;

  select checkin_timeout_hours into v_timeout_hours from gyms where id = v_gym_id;

  select id, checked_in_at into v_open_id, v_open_checked_in_at
  from attendance_events
  where member_id = v_member_id and checked_out_at is null
  order by checked_in_at desc
  limit 1;

  if v_open_id is not null then
    if v_open_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
      -- Stale: auto-close it (AC #3) before recording the new check-in.
      update attendance_events
      set checked_out_at = v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          checkout_type = 'auto'
      where id = v_open_id;

      perform log_audit_event(
        p_action_type => 'attendance_stale_check_in_auto_closed',
        p_gym_id => v_gym_id,
        p_target_entity_id => v_open_id::text,
        p_target_entity_type => 'attendance_event',
        p_metadata => jsonb_build_object(
          'member_id', v_member_id,
          'original_checked_in_at', v_open_checked_in_at,
          'auto_closed_checked_out_at', v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          'timeout_hours', v_timeout_hours
        )
      );
    else
      -- Not stale: AC #2's rejection. The partial unique index above is the
      -- concurrent-request backstop for this same outcome, not the primary
      -- path -- this pre-check is what makes the common case a clean,
      -- specific error message rather than a raw constraint-violation string.
      raise exception 'check_in: member % already has an open check-in', v_member_id;
    end if;
  end if;

  insert into attendance_events (gym_id, member_id)
  values (v_gym_id, v_member_id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function check_in from public;
grant execute on function check_in to authenticated;
```

**No new RLS policy on `attendance_events` or `gyms` is needed** — the function is `SECURITY DEFINER` (runs with the migration-owner's privileges, which bypass RLS, exactly like `renew_subscription()`/`log_audit_event()` already do), and `authenticated` only needs `EXECUTE` on the function itself. `attendance_events` keeps its Story-1.3 deny-all RLS with zero policies (0006) — direct client `SELECT`/`INSERT` on the table stays blocked; all access goes through `check_in()`. Do not add a member-facing `SELECT` policy on `attendance_events` in this story — reading a member's own attendance history is Story 3.10's job, not this one, and this story's UI only needs the single row `check_in()` itself returns.

### Scope Note #3 — Mobile: extend `checkin.ts`, replace the no-op branch in `checkin.tsx`

**`apps/mobile/src/services/checkin.ts`** — add a new exported function alongside (not replacing) `validateGymToken()`:
```ts
export interface RecordCheckInResult {
  status: 'success' | 'already_checked_in' | 'error';
  checkedInAt?: string;
}

export async function recordCheckIn(): Promise<RecordCheckInResult> {
  try {
    const { data, error } = await supabase.rpc('check_in');
    if (error) {
      if (error.message?.includes('already has an open check-in')) return { status: 'already_checked_in' };
      // 23505 on idx_attendance_events_one_open_per_member: the race-window
      // backstop for the same outcome (Scope Note #2) -- maps to the same
      // user-facing result as the pre-check rejection above.
      if (error.code === '23505' && error.message?.includes('idx_attendance_events_one_open_per_member')) {
        return { status: 'already_checked_in' };
      }
      return { status: 'error' };
    }
    return { status: 'success', checkedInAt: data.checked_in_at };
  } catch {
    return { status: 'error' };
  }
}
```
This mirrors `validateGymToken()`'s own shape (a plain result object the screen branches on directly, try/catch-wrapped per that function's Review Findings fix) rather than introducing a shared error-mapper — `packages/types/src/errors.ts`'s `mapSupabaseError` is dashboard/super-admin-only (architecture.md's own locales note: *"mobile stays separate"*), and 3.3 already established that this file does its own lightweight, local result-shape mapping instead.

**`apps/mobile/src/app/(tabs)/checkin.tsx`** — in `handleBarcodeScanned`, the branch that currently runs on a token match (flash, then reset with no overlay) changes to: call `recordCheckIn()` after the match; branch on its `status`:
- `'success'`: flash (existing `FLASH_DURATION_MS` corner animation, unchanged), then show the **Success** overlay (green, per MA-10: ✓ icon, `t('checkin.checkedIn')` heading, the returned `checkedInAt` formatted as a local time string, auto-dismissing after 2.5s back to scanning — no button). Use the same locale-aware, per-file-local formatting convention `apps/mobile/src/app/onboarding/plan.tsx`'s `formatDateOnly` established (`new Date(...).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' })`) rather than adding a shared date-utils module.
- `'already_checked_in'`: show the **Already Checked In** overlay immediately, no flash (matching Wrong-QR's existing no-flash precedent) — amber, per MA-10: ⚠ icon, `t('checkin.alreadyCheckedInTitle')`, `t('checkin.alreadyCheckedInBody')`, an OK button (`t('common.ok')`, new key) that dismisses and resumes scanning, does not auto-dismiss.
- `'error'`: reuse the existing `networkError` overlay/copy exactly as-is (no new state, no new copy) — a failed `check_in()` call is the same class of failure as a failed `validateGymToken()` call from the user's point of view.

Apply the same `mountedRef`/`isFocusedRef` guards around the post-`await recordCheckIn()` state updates that 3.3's Review Findings already added around `validateGymToken()`'s result (a user leaving the tab mid-request must not pop a stale overlay on return, and `processingRef` must reset on an abandoned response so a later scan isn't silently ignored) — same pattern, just applied to this new call site too.

**New i18n keys** (`checkin.*` namespace, `en.json`/`fr.json`, both under `apps/mobile/src/locales/`; run `node scripts/check-i18n-key-parity.mjs` after): `checkedIn` ("Checked in"), `alreadyCheckedInTitle` ("Already checked in"), `alreadyCheckedInBody` ("You're already checked in.\nSee front desk if you need help." — exact MA-10 copy). Add `ok` ("OK") to the existing top-level `common` namespace (`common.close`/`common.tryAgain` already live there) — no other screen has needed an OK-style acknowledgement button yet.

### Scope Note #4 — Explicitly out of scope (other stories' jobs)

- **Denied — Expired** overlay and any subscription-status branching: Epic 4 (FR-031 in the FR Coverage Map, confirmed again in 3.3's own Scope Note #2). `check_in()` does not read or reject on `subscriptions.status` at all — an `expired` member's scan still succeeds and records an attendance event in this story's build; Epic 4 layers the accept/reject-with-alert behavior on top later.
- **Success — Offline** (SQLite queue) and any offline-record-then-sync behavior: Story 3.9. `recordCheckIn()` is online-only, matching `validateGymToken()`'s own online-only precedent.
- **Check-out** (manual or auto-timeout cron): Story 3.5. This story's `check_in()` only ever sets `checked_out_at` when auto-closing a *stale* session as a side effect of a *new* check-in (AC #3) — it never closes the session it just opened, and there is no standalone check-out path here.
- **Home screen check-in status, occupancy display, admin Attendance page, check-in history**: Stories 3.6/3.7/3.10. None of `apps/dashboard`'s `attendance/` route or `apps/mobile`'s `index.tsx`/`history/` are touched.

## Tasks / Subtasks

- [x] **Task 1: Migration `0023` — partial unique index, `checkin_timeout_hours` column, `check_in()` RPC** (AC #1, #2, #3; Scope Note #2)
  - [x] `supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql`: the partial unique index, the `gyms.checkin_timeout_hours integer not null default 8` column, and the `check_in()` function exactly as specified in Scope Note #2 (adapt comments to explain rationale in your own words, matching this repo's established migration-comment density — do not skip the "why," this codebase never ships an uncommented design decision).
  - [x] `revoke execute on function check_in from public; grant execute on function check_in to authenticated;` — no `service_role`/`anon` grant (self-service only, matches `renew_subscription()`'s grant shape minus the staff angle).

- [x] **Task 2: `apps/mobile/src/services/checkin.ts` — `recordCheckIn()`** (AC #1, #2, #3; Scope Note #3)
  - [x] Add `recordCheckIn()` exactly as specified in Scope Note #3: calls `supabase.rpc('check_in')`, maps the "already has an open check-in" message and the `idx_attendance_events_one_open_per_member` 23505 constraint-violation both to `'already_checked_in'`, any other error to `'error'`, success to `{ status: 'success', checkedInAt: data.checked_in_at }`.
  - [x] Keep `validateGymToken()` untouched.

- [x] **Task 3: `apps/mobile/src/app/(tabs)/checkin.tsx` — Success and Already-Checked-In result states** (AC #1, #2, #3; Scope Note #3)
  - [x] Replace the current match-branch (flash → reset, no overlay) with: on match, call `recordCheckIn()`; branch on `status` per Scope Note #3 (`success` → flash then green Success overlay with formatted check-in time, 2.5s auto-dismiss; `already_checked_in` → amber overlay immediately, OK button, no auto-dismiss; `error` → reuse the existing network-error overlay).
  - [x] Apply `mountedRef`/`isFocusedRef` guards around the post-await state updates, matching 3.3's existing pattern for `validateGymToken()`'s result.
  - [x] New i18n keys in `apps/mobile/src/locales/en.json`/`fr.json`: `checkin.checkedIn`, `checkin.alreadyCheckedInTitle`, `checkin.alreadyCheckedInBody`, `common.ok`. Run `node scripts/check-i18n-key-parity.mjs` after.

- [x] **Task 4: pgTAP coverage for `check_in()`** (AC #1, #2, #3; Scope Note #2)
  - [x] New `supabase/tests/check_in_one_open_session_enforcement.test.sql`, following `manual_renewal_reset.test.sql`'s exact session-simulation convention (`set local role authenticated` + `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the connecting role, `reset role` before asserting on committed table state).
  - [x] Assert: a member-claim session with no open check-in calling `check_in()` succeeds (`lives_ok`) and inserts exactly one `attendance_events` row with `checked_out_at is null`.
  - [x] Assert: the same member calling `check_in()` again immediately (open, non-stale session) is rejected via `throws_like('%already has an open check-in%')`, and no second row was inserted.
  - [x] Assert (AC #3): a member with an open check-in whose `checked_in_at` is seeded further in the past than `checkin_timeout_hours` (use the gym's actual configured value, or override it on the fixture gym for a deterministic test) — calling `check_in()` succeeds, the *old* row is now `checked_out_at = checked_in_at + timeout interval` with `checkout_type = 'auto'`, a *new* open row exists, and exactly one `audit_log` row with `action_type = 'attendance_stale_check_in_auto_closed'` was written for the closed row's id.
  - [x] Assert: a coach-claim or owner-claim session (non-`member` `app_role`) calling `check_in()` is rejected via `throws_like('%permission denied%')`.
  - [x] Assert: the partial unique index itself rejects a second concurrent open row for the same `member_id` at the raw SQL level (a direct `INSERT ... throws_like('%idx_attendance_events_one_open_per_member%')` or equivalent, bypassing the function) — proves AC #2's literal "enforced via a partial unique index" wording independently of `check_in()`'s own pre-check.
  - [x] Assert cross-tenant: a Gym B member-claim session's `check_in()` call only ever inserts against Gym B's `gym_id` (`private.gym_id()`-derived), never Gym A's, even with fixtures present in both gyms.

- [x] **Task 5: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages, 0 errors) and `node scripts/check-i18n-key-parity.mjs` (0 errors).
  - [x] `supabase test db` — confirm the new file passes and zero regressions in the existing suite (baseline: 268 passing as of Story 3.3).
  - [x] Run the mobile app as a logged-in member (per `apps/mobile/AGENTS.md`'s versioned-docs guidance for anything touching the existing camera code): scan the gym's real QR twice in a row and confirm the second scan shows "Already checked in"; manually backdate a fixture's `checked_in_at` past the timeout (or temporarily lower `checkin_timeout_hours` on the test gym) and confirm a stale open session auto-closes with a fresh success confirmation on the next scan.

### Review Findings

- [x] [Review][Patch] `validating` state is never reset to `false` when the post-`recordCheckIn()` mounted/focused guard short-circuits — every sibling early-return path in `handleBarcodeScanned` resets it but this one doesn't, so backgrounding the tab mid-RPC can leave the loading spinner stuck showing on return [apps/mobile/src/app/(tabs)/checkin.tsx:172]
- [x] [Review][Patch] Success overlay can pop up stale after the user backgrounds the tab — the `flashTimerRef`/`successTimerRef` timeout callbacks fire unconditionally with no `mountedRef`/`isFocusedRef` guard, unlike the `await recordCheckIn()` continuation in the same function [apps/mobile/src/app/(tabs)/checkin.tsx:192]
- [x] [Review][Patch] `gyms.checkin_timeout_hours` has no `CHECK` constraint against zero/negative values — a future edit could make every check-in instantly auto-close the prior session [supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql:28]
- [x] [Review][Patch] Concurrent `check_in()` calls both hitting the stale-session branch can each pass the open-session read (no `for update` lock) and each write a `log_audit_event()` entry for the same auto-close, producing duplicate audit rows [supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql:98]
- [x] [Review][Patch] `resetScanning()` doesn't clear `success`/`successCheckedInAt` — currently unreachable since scanning is disabled while `success` is showing, but a latent trap for any future caller that reuses `resetScanning` [apps/mobile/src/app/(tabs)/checkin.tsx:131]
- [x] [Review][Patch] The `members` lookup (`user_id`/`gym_id` match) has no `ORDER BY`/`LIMIT 1` — the partial unique index only guarantees one *active* row per user/gym, so if a deactivated historical row ever coexists with an active one, `SELECT INTO` could silently pick the wrong row [supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql:79]
- [x] [Review][Defer] Client-side error classification relies on substring-matching the Postgres error message/constraint name [apps/mobile/src/services/checkin.ts:36] — deferred, pre-existing: this is the literal pattern Scope Note #3 prescribes and mirrors `validateGymToken()`'s established shape
- [x] [Review][Defer] New Success/Already-Checked-In overlays have no accessibility live-region announcement for screen readers [apps/mobile/src/app/(tabs)/checkin.tsx:268] — deferred, pre-existing: the Wrong-QR/network-error overlays this story extends have the same gap
- [x] [Review][Defer] `recordCheckIn()`'s catch-all and generic error branch have no logging/telemetry [apps/mobile/src/services/checkin.ts:41] — deferred, pre-existing: matches `validateGymToken()`'s existing silent-catch pattern exactly
- [x] [Review][Defer] No unit/component test coverage for the new client-side branching logic in `checkin.ts`/`checkin.tsx` [apps/mobile/src/app/(tabs)/checkin.tsx] — deferred, pre-existing: this repo has no existing precedent for mobile unit tests; the established convention is pgTAP + manual on-device verification, which this story followed
- [x] [Review][Defer] The new partial unique index will fail the migration outright if pre-existing duplicate-open-session data violates it [supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql:20] — deferred, pre-existing: an operational/deployment risk, not a code-level fix

**Fix summary:**
- `apps/mobile/src/app/(tabs)/checkin.tsx`: `setValidating(false)` added to the post-`recordCheckIn()` mounted/focused guard's early return; `mountedRef`/`isFocusedRef` checks added inside both the flash and success `setTimeout` callbacks; `resetScanning()` now also clears `success`/`successCheckedInAt`.
- `supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql`: added `check (checkin_timeout_hours > 0)`; added `order by deactivated_at nulls first limit 1` to the caller's `members` lookup; added `for update` to the open-session read to close the concurrent-stale-check-in duplicate-audit-log race.
- Verified: `pnpm --filter @gymos/mobile run typecheck` (0 errors). `supabase db reset` + `supabase test db` (via WSL) re-run clean: 282/282 passing, zero regressions.

## Dev Notes

- **This is the story that turns Story 3.3's deliberately-inert "valid scan" branch into real behavior.** Nothing in 3.3's Wrong-QR path changes; this story is additive on top of it.
- **`check_in()` does not check subscription status.** An `expiring_soon`/`grace_period`/`expired` member's scan still succeeds and records attendance in this story — Epic 4 (FR-031) is what will later intercept and branch on that status. Do not add a subscription check here; it isn't this story's AC and would conflict with Epic 4's eventual implementation.
- **No Settings UI for `checkin_timeout_hours` in this story** (Scope Note #2) — it ships with a working default (8 hours, matching FR-045) and Story 3.5 is where it becomes user-configurable. If dev-story or code-review reaches for a `SettingsForm.tsx` change here, stop and re-read Scope Note #2.
- **The mobile root-layout session gate already excludes deactivated members** (`use-session.ts`'s `isOnboarded` query filters `deactivated_at is null`) — `checkin.tsx` can assume a valid, active member session, same assumption `checkin.tsx`/`profile.tsx` already make (3.3 Dev Notes). `check_in()`'s own `deactivated_at` guard (Scope Note #2) is defense-in-depth for direct API access, not something the mobile UI needs to branch on.
- **Follow `apps/mobile/AGENTS.md`'s standing instruction** to read the exact versioned Expo SDK 57 docs before touching `checkin.tsx` — this story edits an existing `expo-camera`/`CameraView` file, not greenfield code, so match its established conventions (`mountedRef`, `isFocusedRef`, `processingRef`, `Animated` corner brackets) rather than introducing new ones.
- Reuse `log_audit_event()` (0007) for the stale-auto-close write — do not hand-roll a direct `INSERT INTO audit_log`; every other story in this codebase routes through this one function.

### Project Structure Notes

New files:
```
supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql
supabase/tests/check_in_one_open_session_enforcement.test.sql
```

Modified files:
```
apps/mobile/src/services/checkin.ts        # + recordCheckIn()
apps/mobile/src/app/(tabs)/checkin.tsx     # + Success / Already-Checked-In result states
apps/mobile/src/locales/en.json            # + checkin.checkedIn/alreadyCheckedInTitle/alreadyCheckedInBody, common.ok
apps/mobile/src/locales/fr.json            # same keys, FR copy
```

No changes expected to `apps/dashboard`, `apps/super-admin`, `packages/types`, `gym-settings.ts`, `SettingsForm.tsx`, or any existing migration file (Scope Notes #2, #4).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4] — literal AC wording
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#FR-042 through FR-045] — full FR text: QR check-in flow, one-open-check-in + stale auto-close math, configurable auto-timeout shared with Story 3.5
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-10 · Check-In, lines 659-699] — exact copy and layout for the Success (Online) and Already Checked In result states
- [Source: supabase/migrations/0006_attendance.sql] — `attendance_events` table; its own comment anticipating this story's partial unique index
- [Source: supabase/migrations/0002_gyms_and_tiers.sql:13-29] — `gyms` table's existing configurable-settings columns (`grace_period_days`, `capacity`, `alert_auto_dismiss_minutes`) — the precedent `checkin_timeout_hours` follows, and the precedent for *not* needing Settings UI in the same story that adds the column
- [Source: supabase/migrations/0022_manual_renewal_reset.sql, _bmad-output/implementation-artifacts/3-2-manual-renewal-reset.md#Scope Note #5] — `renew_subscription()`, the `SECURITY DEFINER` + self-role-check + `log_audit_event()` pattern `check_in()` follows
- [Source: supabase/migrations/0007_audit_log.sql] — `log_audit_event()`, the canonical audit-write path this story reuses for the stale-auto-close record
- [Source: apps/mobile/src/services/checkin.ts, apps/mobile/src/app/(tabs)/checkin.tsx] — `validateGymToken()` and the existing camera-scanning screen this story extends (unchanged parts: permission handling, Wrong-QR overlay, network-error overlay)
- [Source: _bmad-output/implementation-artifacts/3-3-qr-code-generation-gym-token-validation.md#Scope Note #2, Scope Note #3] — the exact hand-off boundary this story closes; the "one gym per JWT, no multi-gym switcher" reasoning `check_in()`'s no-token-parameter design relies on
- [Source: apps/mobile/src/hooks/use-session.ts] — root-layout gate excluding deactivated members from `(tabs)`, informing this story's Dev Notes on why `checkin.tsx` needn't branch on deactivation itself
- [Source: apps/mobile/src/app/onboarding/plan.tsx:66-68] — `formatDateOnly`'s per-file, locale-aware `toLocaleDateString` convention this story's check-in-time formatting follows (as `toLocaleTimeString`)
- [Source: packages/types/src/errors.ts] — `mapSupabaseError`, confirmed dashboard/super-admin-only (not used by mobile); this story's `recordCheckIn()` follows `validateGymToken()`'s own local-result-shape convention instead
- [Source: supabase/tests/manual_renewal_reset.test.sql] — pgTAP session-simulation convention (`set local role`, `set_config('request.jwt.claims', ...)`, fixture-then-`reset role`-then-assert) this story's new test file follows
- [Source: apps/mobile/AGENTS.md] — standing instruction to read exact versioned Expo SDK 57 docs before editing camera-related code

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Local Supabase reset (`supabase db reset`, via WSL) applied migration `0023` cleanly against the full existing migration history (0001–0022), no errors.
- `pnpm --filter @gymos/mobile run typecheck` and `pnpm run typecheck` (all 4 packages) — 0 errors.
- `node scripts/check-i18n-key-parity.mjs` — 0 errors (mobile locale count: 86 → 90 keys, EN/FR in parity).
- `supabase test db` (full suite, local via WSL Docker): first run of the new test file failed 4/14 assertions — a test-authoring bug, not a `check_in()` bug: several assertions filtered `attendance_events.member_id` by the fixture's `auth.users.id` instead of the corresponding `members.id` (the two are different UUIDs in the fixture). Fixed the four affected assertions to reference the correct `members.id` values; re-ran — 282/282 passing (268 baseline from Story 3.3 + 14 new in `check_in_one_open_session_enforcement.test.sql`), zero regressions.
- `pnpm run lint`: `@gymos/mobile`'s `expo lint` fails with `'eslint' is not recognized` — a pre-existing local Windows PATH issue unrelated to this story's changes (not introduced by this story; `@gymos/dashboard`/`@gymos/super-admin` lint clean).
- Task 6 manual mobile verification (physical Android device via Expo Go, WSL2 mirrored networking): seeded a temporary tier/gym/member fixture (phone `+237 600000001`, matching the app's fixed Cameroon-only prefix — a fake US-format test number was tried first and had to be redone once this was noticed) and a matching `auth.users` row via the GoTrue admin API, with `[auth.sms.test_otp]` temporarily enabled in `supabase/config.toml` for that number (code `123456`) to log in without a real SMS send. Generated a QR image encoding the fixture gym's `gym_token` (the `qrcode` npm package, same as the dashboard's own QR renderer) and displayed it on-screen for the phone to scan.
- Hit two rounds of local-environment instability unrelated to this story's code: (1) the Supabase Kong container transiently crash-looped under concurrent typecheck/build load, self-resolved; (2) Windows→WSL2 reachability on port 54321 was consistently broken from the Windows host's own network stack (`netstat` showed no record of the port at all, while an ad-hoc test container on a different port was reachable fine) even after a full `wsl --shutdown`/restart — but the physical phone's traffic (arriving via the LAN/Wi-Fi interface rather than the Windows loopback path) got through regardless once the stack was freshly restarted, so the device test itself was not blocked by this. Also caught and fixed a fixture gap along the way: `phone_has_membership()` checks `members.phone`, which the first fixture pass left null, initially surfacing as "number not registered" on the phone.
- Verified all three scenarios live on the device: a fresh scan showed the green "Checked in" overlay (with the actual check-in time) auto-dismissing after ~2.5s; an immediate second scan showed the amber "Already checked in" overlay with a working OK button; after backdating the open `attendance_events` row's `checked_in_at` by 9 hours (past the 8-hour default `checkin_timeout_hours`) directly in the DB, a third scan produced a fresh green "Checked in" overlay again. Confirmed via direct DB query afterward: the original row had `checked_out_at = checked_in_at + 8h` and `checkout_type = 'auto'`, a new open row existed, and exactly one `audit_log` row with `action_type = 'attendance_stale_check_in_auto_closed'` was written for the closed row's id — matching AC #3 exactly.
- All test fixtures (member/gym/tier/two auth users), the temporary `test_otp` config change, and the QR/Metro/Supabase processes started for this verification were fully reverted/stopped afterward; `supabase test db` re-run clean (282/282) post-revert.

### Completion Notes List

- AC #1 and #2 implemented via a new `check_in()` SECURITY DEFINER RPC (migration `0023`) following `renew_subscription()`'s established shape: derives member/gym from the caller's own session (no `p_member_id`/token parameter, per Scope Note #2), checks for an existing open session, auto-closes it if stale (AC #3) with an audit log write, then inserts the new attendance event — all in one atomic function to avoid the race window three separate client calls would have.
- AC #2's literal "enforced via a partial unique index" wording is satisfied by `idx_attendance_events_one_open_per_member` (a partial unique index on `member_id` where `checked_out_at is null`) — this is the concurrent-request backstop behind `check_in()`'s own pre-check, and Task 4's test suite proves it independently at the raw SQL level.
- `gyms.checkin_timeout_hours` added with a `default 8` (FR-045) and no Settings UI field in this story, per Scope Note #2 — Story 3.5's job.
- Mobile: `recordCheckIn()` added to `checkin.ts` (`validateGymToken()` untouched); `checkin.tsx`'s match branch now calls it and renders the Success (green, auto-dismiss 2.5s) and Already Checked In (amber, OK button, no auto-dismiss) overlays per EXPERIENCE.md's MA-10, reusing the existing network-error overlay for RPC failures. Same `mountedRef`/`isFocusedRef` guard pattern from Story 3.3's review findings applied around the new `recordCheckIn()` await.
- New i18n keys (`checkin.checkedIn`/`alreadyCheckedInTitle`/`alreadyCheckedInBody`, `common.ok`) added to both `en.json`/`fr.json`, parity-checked.
- pgTAP: `check_in_one_open_session_enforcement.test.sql`, 14 assertions covering fresh check-in, repeat-check-in rejection, stale auto-close (auditing included), permission denial for coach/owner claims, the raw partial-unique-index backstop, and cross-tenant isolation.
- Task 5's physical-device manual verification was completed live with the user via Expo Go over the local network, matching Story 3.3's precedent: fresh check-in (green "Checked in" + time, auto-dismiss), immediate repeat scan (amber "Already checked in", OK button), and a backdated stale session (auto-close + fresh success), all confirmed both visually on-device and against the underlying `attendance_events`/`audit_log` rows. See Debug Log for the full fixture/config setup, two environment hiccups encountered along the way (unrelated to this story's code), and teardown.

### File List

**New:**
- `supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql`
- `supabase/tests/check_in_one_open_session_enforcement.test.sql`

**Modified:**
- `apps/mobile/src/services/checkin.ts` (+ `recordCheckIn()`)
- `apps/mobile/src/app/(tabs)/checkin.tsx` (+ Success / Already-Checked-In result states)
- `apps/mobile/src/locales/en.json` (+ `checkin.checkedIn`/`alreadyCheckedInTitle`/`alreadyCheckedInBody`, `common.ok`)
- `apps/mobile/src/locales/fr.json` (same keys, FR copy)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow status tracking)

No changes to `apps/dashboard`, `apps/super-admin`, `packages/types`, `gym-settings.ts`, `SettingsForm.tsx`, or any existing migration file (Scope Notes #2, #4).

## Change Log

- 2026-07-24: Story implemented. Added migration `0023` (`check_in()` SECURITY DEFINER RPC, the `idx_attendance_events_one_open_per_member` partial unique index, and `gyms.checkin_timeout_hours`) turning Story 3.3's inert valid-scan branch into real attendance recording with one-open-session enforcement (AC #1/#2) and stale-session auto-close (AC #3). Mobile: `recordCheckIn()` added to `checkin.ts`; `checkin.tsx` now renders MA-10's Success (green, auto-dismiss) and Already Checked In (amber, OK button) overlays. New i18n keys (EN/FR, parity-checked). New pgTAP suite (`check_in_one_open_session_enforcement.test.sql`, 14 assertions). `pnpm run typecheck` (4/4 packages) and i18n-parity clean. `supabase test db`: 282/282 passing (268 baseline + 14 new), zero regressions. Manually verified end-to-end on a physical device via Expo Go over the local network: fresh check-in, immediate repeat-scan rejection, and backdated stale-session auto-close all confirmed on-device and against the underlying `attendance_events`/`audit_log` rows. Status set to `review`.
