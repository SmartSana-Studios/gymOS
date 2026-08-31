---
baseline_commit: fd5d08dcf25302a7c45830d59cd23748d304b333
---

# Story 12.4: Member App Classes Surfaces

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want to see my upcoming booked classes and browse available sessions from the app,
so that I know my schedule without asking the front desk.

## Acceptance Criteria

1. **Given** the Home screen (`(tabs)/index.tsx`, MA-09), **when** the member has ≥1 upcoming booked class, **then** an "Upcoming Classes" section appears showing up to 2 nearest sessions (class name, day/time); tapping it navigates to the Classes tab pre-selected to "My Bookings." The section is **absent entirely** (not an empty state) when the member has zero upcoming bookings (FR-108, MA-09 mockup).
2. **Given** the app's bottom tab bar, **when** this story ships, **then** it reaches EXPERIENCE.md's originally-specified 5-tab V1.5 set: Home, Check-In, **Classes** (new), Progress, Profile — achieved by adding a `classes` trigger **and completing Story 10.3's explicitly deferred History→Profile move** (History's tab-bar trigger is removed; the History screen itself is unchanged and becomes reachable via a new row in Profile, mirroring the existing "Body profile" row pattern) (FR-123, EXPERIENCE.md Navigation Structure).
3. **Given** the new Classes tab, **when** opened, **then** it shows a segmented control ("Available" | "My Bookings", mirroring History's existing segmented-control pattern), defaulting to "Available" (or "My Bookings" when arrived at via AC #1's Home link).
4. **Given** the Available sub-tab, **when** it loads, **then** it lists upcoming class sessions chronologically: class name, day/time, assigned coach's name, and capacity as "booked/total"; each row's action is "Book" (enabled) or "Full" (disabled) per current capacity (FR-105, MA-16 mockup). Tapping a row expands the class description inline — no separate detail screen.
5. **Given** a bookable session, **when** the member taps "Book," **then** it calls the already-shipped `book_class_session()` RPC (Story 12.2, `services/classes.ts`'s `bookClassSession()`) with optimistic UI (brief spinner, then confirm or revert); if the server rejects because the session filled in the interim (`status: 'full'`), the button reverts to "Full" with a toast: "That spot was just taken — try another session." (MA-16 Interactions, FR-105).
6. **Given** the My Bookings sub-tab, **when** it loads, **then** it lists the member's own upcoming booked sessions (class name, day/time); each row's action is "Cancel" (enabled, before the gym's cancellation cutoff) or a static "Cancellation closed" label (past cutoff) — no live countdown needed, the state is fixed at load (FR-106, MA-16 mockup).
7. **Given** an active booking before its cutoff, **when** the member taps "Cancel," **then** an inline confirm ("Cancel this booking?" [Keep] / [Cancel booking]) appears; on confirm it calls the already-shipped `cancel_class_booking()` RPC (Story 12.2), the row is removed from My Bookings, and the freed spot is reflected in Available on next load (FR-106).
8. **Given** no network connectivity, **when** the Classes tab is opened, **then** it shows a persistent banner ("You're offline — classes can't be booked right now") over the last-loaded list, and Book/Cancel actions are disabled — class booking is explicitly excluded from the mobile offline queue (AD-23), unlike Check-In/Progress.
9. **Given** classes and workout plans, **when** either is presented in the app, **then** they remain distinct, separately-navigable features (FR-108) — trivially satisfied in this story since no Workout Plans UI exists yet (Epic 13, still `backlog`); do not add any cross-navigation or shared component between them.

## Tasks / Subtasks

- [x] **Task 1: Add the two new member-facing list RPCs** (AC: #1, #4, #6)
  - [x] Create `supabase/migrations/0078_member_app_classes_surfaces.sql` (next sequential after `0077_pay_now_tier_selection_alternate_payment.sql`).
  - [x] **Read this before writing SQL — the real design gap this story closes:** `classes`/`class_sessions`' existing RLS (`gym_staff_read_own_classes`/`gym_staff_read_own_class_sessions`, 0057) is **misleadingly named** — it has no role filter at all (`using (gym_id = private.gym_id())`), so a `member`-role session can already `SELECT` both tables directly, no new policy needed there. The two real gaps: (a) **capacity aggregate** — a member's own RLS on `class_bookings` (`member_read_own_class_bookings`, 0058) only ever returns their *own* row(s), so a client-side `count(*)` would undercount every session's true booked total; (b) **coach name** — `member_read_gym_staff_members` (0038) explicitly excludes `role = 'coach'` from a member's read access to `members` (deliberate at the time; do not widen it — that touches unrelated payment-actor-visibility scope). Both gaps are closed the same way `private.gym_occupancy_band()` (0056) and every other member-facing aggregate in this codebase are closed: a narrow `SECURITY DEFINER` RPC that returns only the derived fields a member needs, never raw peer rows.
  - [x] `list_bookable_class_sessions()` — member-only `SECURITY DEFINER` RPC, follows `book_class_session()`'s (0058) exact role-check → resolve-gym → resolve-member shape (copy its member-resolution block verbatim, including the `deactivated_at nulls first` tie-break and the deactivated-member guard):
    ```sql
    create function list_bookable_class_sessions()
    returns table (
      class_session_id uuid,
      class_name text,
      description text,
      coach_name text,
      scheduled_at timestamptz,
      capacity integer,
      booked_count bigint,
      my_booking_id uuid
    )
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_gym_id uuid;
      v_member_id uuid;
      v_deactivated_at timestamptz;
    begin
      if not ((auth.jwt() ->> 'app_role') = 'member') then
        raise exception 'list_bookable_class_sessions: caller is not a member';
      end if;
      v_gym_id := private.gym_id();
      if v_gym_id is null then
        raise exception 'list_bookable_class_sessions: caller is not a member';
      end if;
      select id, deactivated_at into v_member_id, v_deactivated_at
      from members where user_id = auth.uid() and gym_id = v_gym_id
      order by deactivated_at nulls first limit 1;
      if v_member_id is null then
        raise exception 'list_bookable_class_sessions: no member record found for the caller';
      end if;
      if v_deactivated_at is not null then
        raise exception 'list_bookable_class_sessions: member is deactivated';
      end if;

      return query
      select cs.id, c.name, c.description, coach.name, cs.scheduled_at, c.capacity,
             (select count(*) from class_bookings cb where cb.class_session_id = cs.id),
             (select cb.id from class_bookings cb where cb.class_session_id = cs.id and cb.member_id = v_member_id)
      from class_sessions cs
      join classes c on c.id = cs.class_id
      join members coach on coach.id = c.coach_id
      where cs.gym_id = v_gym_id and cs.scheduled_at > now()
      order by cs.scheduled_at asc;
    end;
    $$;
    revoke execute on function list_bookable_class_sessions() from public;
    grant execute on function list_bookable_class_sessions() to authenticated;
    ```
    Note: `scheduled_at > now()` mirrors `book_class_session()`'s own `cs.scheduled_at <= now()` rejection guard exactly — a session that becomes unbookable naturally drops off this list, no separate filter logic to keep in sync.
  - [x] `list_my_class_bookings()` — same member-only role-check/resolve shape, returns the caller's own upcoming bookings with `can_cancel` computed server-side (identical cutoff formula to `cancel_class_booking()`'s own `now() >= v_scheduled_at - make_interval(mins => v_cutoff_minutes)`, just inverted and returned instead of raised) — this avoids the client needing its own read access to `gyms.class_booking_cancellation_cutoff_minutes` or duplicating cutoff-window math:
    ```sql
    create function list_my_class_bookings()
    returns table (
      booking_id uuid,
      class_name text,
      scheduled_at timestamptz,
      can_cancel boolean
    )
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_gym_id uuid;
      v_member_id uuid;
      v_deactivated_at timestamptz;
    begin
      if not ((auth.jwt() ->> 'app_role') = 'member') then
        raise exception 'list_my_class_bookings: caller is not a member';
      end if;
      v_gym_id := private.gym_id();
      if v_gym_id is null then
        raise exception 'list_my_class_bookings: caller is not a member';
      end if;
      select id, deactivated_at into v_member_id, v_deactivated_at
      from members where user_id = auth.uid() and gym_id = v_gym_id
      order by deactivated_at nulls first limit 1;
      if v_member_id is null then
        raise exception 'list_my_class_bookings: no member record found for the caller';
      end if;
      if v_deactivated_at is not null then
        raise exception 'list_my_class_bookings: member is deactivated';
      end if;

      return query
      select cb.id, c.name, cs.scheduled_at,
             (now() < cs.scheduled_at - make_interval(mins => g.class_booking_cancellation_cutoff_minutes))
      from class_bookings cb
      join class_sessions cs on cs.id = cb.class_session_id
      join classes c on c.id = cs.class_id
      join gyms g on g.id = cb.gym_id
      where cb.member_id = v_member_id and cb.gym_id = v_gym_id and cs.scheduled_at > now()
      order by cs.scheduled_at asc;
    end;
    $$;
    revoke execute on function list_my_class_bookings() from public;
    grant execute on function list_my_class_bookings() to authenticated;
    ```
    (`cb.gym_id = v_gym_id` is redundant with `cb.member_id = v_member_id` in practice — a member row belongs to exactly one gym — but matches this codebase's established explicit-gym-scoping-as-defense-in-depth convention on every query, per Story 12.3's own Task 2 precedent.)
  - [x] No RLS policy changes in this migration — both new functions are `SECURITY DEFINER` and deliberately bypass the `members`/`class_bookings` read restrictions only for their own narrow, already-scoped-to-caller projections. Do not touch `member_read_gym_staff_members`, `gym_staff_read_own_classes`, or any Story 12.1–12.3 policy.

- [x] **Task 2: Extend the mobile classes service** (AC: #1, #4, #5, #6, #7)
  - [x] In `apps/mobile/src/services/classes.ts` (already has `bookClassSession()`/`cancelClassBooking()` from Story 12.2 — extend this file, do not create a new one), add `listBookableClassSessions(): Promise<BookableClassSession[] | null>` and `listMyClassBookings(): Promise<MyClassBooking[] | null>` — follow `services/payments.ts`'s `loadPaymentsPage()` exact `T[] | null` contract (`null` = real load error for the caller to show a retry state; `[]` = legitimately empty), **not** `checkin.ts`'s best-effort-swallow-to-`[]` contract — the Classes tab itself needs a real error/retry state (mirrors `history/index.tsx`), unlike Home's best-effort widgets.
  - [x] Map `list_bookable_class_sessions()`'s snake_case RPC row shape to camelCase: `{ classSessionId, className, description, coachName, scheduledAt, capacity, bookedCount, myBookingId }`. Map `list_my_class_bookings()` to `{ bookingId, className, scheduledAt, canCancel }`.
  - [x] `bookClassSession()`/`cancelClassBooking()` already exist and are fully wired to `book_class_session()`/`cancel_class_booking()` (Story 12.2) — reuse them as-is, do not modify their signatures or add new call sites inside them.

- [x] **Task 3: Build the Classes tab screen** (AC: #3, #4, #5, #6, #7, #8, #9)
  - [x] New `apps/mobile/src/app/(tabs)/classes/index.tsx`. Read `apps/mobile/src/app/(tabs)/history/index.tsx` (full file) first — it is the closest precedent for this screen's shape: `SegmentedControl` (already exists, `@/components/ui/SegmentedControl`, reuse directly), `FlatList`, `RefreshControl`/pull-to-refresh, loading/error/empty states, `requestIdRef`/`isCurrent()` stale-response guard (mirrors `(tabs)/index.tsx`'s own pattern, needed here too since switching sub-tabs can race in-flight fetches).
  - [x] Read the segmented-control's initial value from `useLocalSearchParams()` (a `tab` param, `'available' | 'bookings'`) so AC #1's Home link can deep-link straight to "My Bookings" — mirrors `profile.tsx`'s existing `{ pathname, params: { from: 'profile' } }` route-param pattern. Default to `'available'` when absent.
  - [x] **Available tab:** call `listBookableClassSessions()`. Row: class name, formatted day/time (reuse `formatCheckInTimestamp`-style `toLocaleString(locale, { dateStyle, timeStyle })`, do not invent a new date formatter), coach name, "{bookedCount}/{capacity}" capacity text. Row action: "Book" if `bookedCount < capacity && myBookingId === null`; "Full" (disabled) if `bookedCount >= capacity`; **"Booked" (disabled)** if `myBookingId !== null` — a UI-state decision not literally drawn in the MA-16 mockup (which only shows Book/Full) but required for correctness (a member can't re-book their own session, and hiding the row entirely would make it harder to find in a chronological list). Tapping a row (not the button) expands its `description` inline.
  - [x] **My Bookings tab:** call `listMyClassBookings()`. Row: class name, formatted day/time. Row action: "Cancel" if `canCancel`; static "Cancellation closed" text (no button) otherwise.
  - [x] **Book flow:** tap → local optimistic state (spinner on that row's button) → `bookClassSession(classSessionId)` → on `{status: 'success'}` update the row to "Booked" and increment local `bookedCount`; on `{status: 'full'}` revert to "Full" + toast (`classes.available.raceLost` — copy from MA-16: "That spot was just taken — try another session."); on `{status: 'ineligible'}` toast `classes.available.ineligible` (new copy, no subscription — mirror the tone of `home.expiredNote`); on `{status: 'already_booked'}` treat as success (idempotent, refresh row to "Booked"); on `{status: 'error'}` generic retry toast.
  - [x] **Cancel flow:** tap "Cancel" → `Alert.alert` confirm (title/body/actions per MA-16: "Cancel this booking?" / [Keep] / [Cancel booking] — same `Alert.alert` two-button shape as `profile.tsx`'s `handleLogOut` / `progress/entries.tsx`'s delete confirm) → on confirm, `cancelClassBooking(bookingId)` → on `{status: 'success'}` remove the row from local state; on `{status: 'cutoff_passed'}` (race: cutoff passed between load and tap) refresh the list so the row now shows "Cancellation closed"; on `{status: 'not_found'}`/`{status: 'error'}` generic retry toast.
  - [x] **Offline banner (AC #8):** read `isConnected` from `useOfflineSync()` (already exists, `@/lib/offline-sync-context` — do not add new offline-queue plumbing, AD-23 explicitly excludes class booking from the SQLite offline queue). When `!isConnected`, render a persistent banner (mirror `(tabs)/index.tsx`'s existing `offlineBanner`/`offlineBannerText` style tokens, new copy `classes.offlineBanner`) over the last-successfully-loaded list, and disable every Book/Cancel button — do not attempt the RPC call while offline (fails fast in the UI rather than surfacing a raw network-error toast).
  - [x] Empty states, distinct per tab per Story 12.3's own lesson (avoid two different "nothing here" scenarios reading identically): Available → `classes.available.empty` ("No upcoming classes scheduled. Check back soon."); My Bookings → `classes.bookings.empty` ("You haven't booked any classes yet.") with a link/pressable that switches the segmented control to Available.
  - [x] Load error state (both tabs, `data === null`): mirror `(tabs)/index.tsx`'s `loadError` card — message + "Try again" link.

- [x] **Task 4: Tab-bar restructure — add Classes, complete the deferred History move** (AC: #2)
  - [x] **Read `apps/mobile/AGENTS.md` first** — "Expo HAS CHANGED," verify all Native Tabs APIs against the exact versioned docs (`https://docs.expo.dev/versions/v57.0.0/`) before writing, same requirement Story 10.3 already followed for its own tab addition.
  - [x] `apps/mobile/src/components/app-tabs.tsx`: add a new `<NativeTabs.Trigger name="classes">` between `checkin` and `progress` (final native order: `index`, `checkin`, `classes`, `progress`, `profile`), label "Classes" (hardcoded English string, matching this file's own established convention that no trigger label runs through `t()` — confirmed by Story 10.3's own Dev Notes: "no other trigger label is run through `t()`... a pre-existing pattern, not this story's to fix"). Icon: MA-16 mockup specifies "Calendar icon" — verify the exact SF Symbol/Material icon name against the v57 docs (candidates: `sf="calendar"`, `md="event"`, but confirm before committing). **Remove the `<NativeTabs.Trigger name="history">` entry entirely** — this is the completion of Story 10.3's explicitly deferred move (see Previous Story Intelligence below).
  - [x] `apps/mobile/src/components/app-tabs.web.tsx`: add a matching `<TabTrigger name="classes" href="/classes" asChild>` between the existing `checkin` and `progress` triggers. This file's pre-existing 4-trigger set (`home`, `checkin`, `progress`, `profile`) already has no `history` trigger at all (a pre-existing native/web divergence predating this story, per Story 10.3's own Dev Notes — do not add or remove anything History-related here).
  - [x] **Verify (do not assume) that removing the `history` NativeTabs.Trigger while `apps/mobile/src/app/(tabs)/history/index.tsx` (and its `payment/[id].tsx` sub-route) remain on disk does not break `router.push('/history')` navigability** — this app already proves the "non-tab-trigger route nested under `(tabs)`, reached only via `router.push`" pattern works (e.g. `(tabs)/progress/entries.tsx`, `(tabs)/progress/photo/[id].tsx`, `(tabs)/history/payment/[id].tsx` are all already exactly this shape), so this is expected to be safe, but confirm against the v57 docs/a real device or web build before treating it as done — this is the one genuinely novel mechanical risk in this task.
  - [x] `apps/mobile/src/app/(tabs)/profile.tsx`: add a new row navigating to `/history`, placed and styled like the existing `profile.bodyProfile` row (same `<View style={[styles.row, ...]}><Pressable onPress={() => router.push('/history')} style={styles.rowContent}>...→</Pressable></View>` shape, `accessibilityRole="button"`). New i18n key `profile.history` (label). This is the other half of the deferred move — History gets a real navigation entry point now that its tab-bar shortcut is gone.

- [x] **Task 5: Wire Home screen's Upcoming Classes summary** (AC: #1)
  - [x] In `apps/mobile/src/app/(tabs)/index.tsx`'s `loadHome()`, add a **best-effort, non-blocking** call to `listMyClassBookings()` (matches this function's existing `occupancyBand`/`taraMoneyConnected` treatment — wrap in its own local `try/catch`, a failure here must never trip the outer `loadError`), store the first 2 results in a new `upcomingClasses` state array.
  - [x] Render a new section (after the quick-actions row, before Recent Activity, matching MA-09's layout order) **only when `upcomingClasses.length > 0`** — absent entirely otherwise, not an empty state (explicit mockup requirement). Each row: class name + formatted day/time. A "→" header navigates to `router.push({ pathname: '/classes', params: { tab: 'bookings' } })` (Task 3's deep-link param).
  - [x] New i18n keys under `home.*`: `home.upcomingClasses` (section title), reuse existing date-formatting helpers already in this file.

- [x] **Task 6: pgTAP coverage for the two new RPCs** (AC: #1, #4, #6)
  - [x] Create `supabase/tests/member_app_classes_surfaces.test.sql`. Follow `class_booking_with_capacity_enforcement.test.sql`'s exact fixture/RPC-testing conventions (deterministic UUIDs, `transaction`, `plan(...)`, `finish()`, rollback).
  - [x] `list_bookable_class_sessions()`: returns the correct `booked_count` aggregated across **all** members' bookings on a session (not just the caller's — this is the whole point of the RPC, must be proven with ≥2 different members' bookings on the same session); returns the correct `coach_name` (proves the `SECURITY DEFINER` bypass of `member_read_gym_staff_members`'s coach exclusion actually works); `my_booking_id` is `null` when the caller hasn't booked and matches the real booking id when they have; excludes past sessions (`scheduled_at <= now()`); excludes cross-gym sessions; ordered chronologically; a non-member (staff/coach) role cannot call it (role check).
  - [x] `list_my_class_bookings()`: returns only the caller's own bookings, never another member's; `can_cancel` is `true` before the gym's configured cutoff and `false` after (use two fixture sessions straddling the cutoff, matching `cancel_class_booking()`'s own test fixture shape from `class_booking_with_capacity_enforcement.test.sql`); excludes past sessions; excludes cross-gym bookings; a non-member role cannot call it.
  - [x] Run the full `supabase test db` suite and confirm zero regressions — this migration is additive-only (two new functions, no schema/RLS changes).

- [x] **Task 7: Regenerate types, validate, and document** (AC: #1–#9)
  - [x] Regenerate `packages/types/src/database.ts` via the pg-meta HTTP-endpoint devcontainer workaround if `supabase gen types typescript --local` reproduces the known zero-byte-stdout bug (documented in every story since 4.13). Confirm the diff contains exactly `list_bookable_class_sessions`/`list_my_class_bookings`'s new function signatures — nothing else. Per Story 12.3's own finding, `database.ts` may already be missing several unrelated prior functions/tables (`progress_entries`, `switch_active_gym`, etc.) — do not attempt to backfill those in this story, out of scope, already flagged in `docs/decisions.md`.
  - [x] Run `supabase db reset`, the full `supabase test db` suite, `pnpm run typecheck`, `pnpm run lint`, `pnpm run check:i18n` (covers `apps/mobile/src/locales`, confirmed by Story 10.3).
  - [x] Add a dated `docs/decisions.md` entry covering: (a) the two new `SECURITY DEFINER` RPCs and why (capacity aggregate + coach-name read both require bypassing a member's own restrictive RLS on `class_bookings`/`members`, mirroring `private.gym_occupancy_band()`'s established aggregate-not-raw-rows pattern rather than widening `member_read_gym_staff_members`'s deliberate coach exclusion); (b) the tab-bar restructure completing Story 10.3's explicitly deferred History→Profile move; (c) `can_cancel` computed server-side in `list_my_class_bookings()` rather than the client reading `gyms.class_booking_cancellation_cutoff_minutes` directly, to keep the cutoff formula in one place (matching `cancel_class_booking()`'s own copy); (d) the "Booked" disabled row-state on the Available tab for an already-booked session, a small addition beyond MA-16's literal Book/Full-only mockup.
  - **Manual device/browser verification is this session's responsibility, not something this story can complete unattended** (no device/simulator or browser automation available in this environment, same disclosure as every prior mobile story since Epic 9): confirm Home's Upcoming Classes summary appears/disappears correctly, Available/My Bookings load real data, Book/Cancel/race-lost/offline-banner states all render correctly, and the tab bar shows exactly 5 triggers with History reachable from the new Profile row.

### Review Findings

- [x] [Review][Decision] AC #7's confirm-dialog spec contradicts itself (button order + inline-vs-modal), shipped code follows the Task 3 subtask's explicit precedent, not the AC's literal prose — AC #7 states "an inline confirm ('Cancel this booking?' [Keep] / [Cancel booking])," but Task 3's own subtask instructs a native `Alert.alert` with the same destructive-first two-button shape as `profile.tsx`'s `handleLogOut` — which the shipped code follows exactly (`Cancel booking` first/destructive, `Keep` second/cancel), reversing the AC's literal button order and using a system modal instead of an inline element. **Resolved: keep as shipped, no code change.** The Task subtask's explicit instruction and the codebase's only existing confirm-dialog precedent (`profile.tsx`'s `handleLogOut`) govern; AC #7's prose is imprecise, not binding.
- [x] [Review][Patch] Home's "Upcoming Classes" deep link to My Bookings is silently ignored once the Classes screen is already mounted [apps/mobile/src/app/(tabs)/classes/index.tsx:50] — `activeTab` is only initialized from `params.tab` once via `useState`; no effect re-syncs it when `params.tab` changes on a subsequent navigation, so a second tap of Home's Upcoming Classes link (after the Classes tab has been visited once) no longer lands on "My Bookings" as AC #1 requires. Fixed: added a `useEffect` syncing `activeTab` when `params.tab` becomes `'bookings'`.
- [x] [Review][Patch] `listBookableClassSessions()`/`listMyClassBookings()` omit the try/catch every other `.rpc()`-calling function in this codebase has [apps/mobile/src/services/classes.ts:127-142, 164-175] — unlike `checkin.ts` and `payments.ts`, a rejection from `supabase.rpc()` here is unhandled; concretely, `handleAvailableRefresh()`/`handleBookingsRefresh()` [apps/mobile/src/app/(tabs)/classes/index.tsx:125-141] `await` the load functions without `try/finally`, so the pull-to-refresh spinner would never clear if the RPC call ever rejects. Fixed: wrapped both functions in try/catch, returning `null` on catch (matching the existing contract).
- [x] [Review][Patch] `already_booked` book-result stores the session id into `myBookingId`, a field documented and consumed elsewhere as a real `class_bookings.id` [apps/mobile/src/app/(tabs)/classes/index.tsx:177] — harmless today (only null-checked, never dereferenced further), but a landmine for the next feature that trusts the field's documented meaning. Fixed: introduced a local-only `optimisticBooked` flag on the `AvailableRow` type instead, so `myBookingId` always stays either `null` or a real booking id.
- [x] [Review][Patch] A failed pull-to-refresh on Available/My Bookings leaves stale data on screen with no user feedback [apps/mobile/src/app/(tabs)/classes/index.tsx:284-293, 344-353] — the error card only renders when the list is empty (`available.length === 0`/`bookings.length === 0`), so a refresh failure while rows already exist fails silently. Fixed: `loadAvailable()`/`loadBookings()` now return a success boolean; `handleAvailableRefresh()`/`handleBookingsRefresh()` show a toast (new `classes.available.refreshError`/`classes.bookings.refreshError` i18n keys) when a refresh fails while rows already exist.
- [x] [Review][Patch] No pgTAP coverage for the deactivated-member guard on either new RPC [supabase/tests/member_app_classes_surfaces.test.sql] — the migration's own comments state the guard was "copied verbatim" from `book_class_session()`'s tested precedent, but neither `list_bookable_class_sessions()` nor `list_my_class_bookings()` has a `throws_ok` assertion exercising it. Fixed: added a deactivated-member fixture and one `throws_like` assertion per RPC (plan count 10 -> 12).
- [x] [Review][Defer] `bookRowState()`'s Booked > Full > Book priority logic [apps/mobile/src/app/(tabs)/classes/index.tsx:28-32] ships with no automated test coverage — deferred, pre-existing (the mobile app has no test framework/runner anywhere in this codebase; this is the same systemic gap every prior mobile story has disclosed, not specific to this diff).

## Dev Notes

### This Story's Real Crux — Read This First

Stories 12.1–12.3 built the entire class/booking/attendance data model and the dashboard-side admin UI. Story 12.2 explicitly deferred **all** member-facing UI to this story, shipping only a headless `apps/mobile/src/services/classes.ts` with `bookClassSession()`/`cancelClassBooking()` — this story's Task 2 extends that same file, it does not create a new one. The genuinely new design surface is narrow but real: **member-role RLS on `classes`/`class_sessions`/`class_bookings`/`members` was designed for the dashboard's staff-side needs (Stories 12.1–12.3), not this story's browse/capacity-count/coach-name needs**, and two small `SECURITY DEFINER` RPCs (Task 1) close exactly that gap — nothing else in this story requires new schema or RLS changes.

### Previous Story Intelligence — The Deferred Tab-Bar Move

Story 10.3 (Progress screen, the last mobile story before this one) added `progress` as the tab bar's 5th trigger but **deliberately left `history` in place too** (6 triggers were never actually shipped — Story 10.3 stopped at 5: `index`, `checkin`, `progress`, `history`, `profile`), explicitly deferring "the History→Profile-row move... to Story 12.4" in its own Dev Notes, because that is "the story that will actually push tab count to 6 and need to solve the ceiling problem." **This is not optional cleanup — it is a load-bearing part of AC #2.** Without it, adding `classes` now would produce a 6-tab bar, exceeding EXPERIENCE.md's explicit design ceiling (iOS HIG / Material Design ~5-tab cap) and contradicting the UX spec's own stated final layout. Task 4 is where this gets resolved: remove the `history` native trigger, add a `classes` trigger in a sensible position, and add a real "History" entry point inside `profile.tsx`.

### Architecture Compliance

- **AD-21**'s RPC-vs-lighter-mechanism flag for Epic 12 was already resolved by Story 12.2 for booking/cancellation (`book_class_session()`/`cancel_class_booking()`, reused as-is here) and by Story 12.3 for attendance (`mark_class_attendance()`, untouched by this story). This story's own two new RPCs (`list_bookable_class_sessions()`/`list_my_class_bookings()`) are a **new** design call, not something AD-21 or any prior story already named — flagged for confirmation the same way 12.1–12.3 each flagged their own novel RPC/schema decisions. If judged wrong, the fallback is a same-shape single combined RPC (fewer round trips) or narrowing `member_read_gym_staff_members` instead (rejected here as broader-blast-radius — see Task 1's reasoning).
- **AD-23** (mobile offline-queue architecture) explicitly excludes class booking from the SQLite offline queue — "its synchronous, row-locked capacity check has no offline-queueable equivalent." This story's offline handling (AC #8, Task 3) is a **read-only connectivity gate** (disable actions, show a banner), never a queue. Do not add a third `sqlite.ts` table or a third `services/*.ts` `queueOffline*`/`syncPending*` pair — `apps/mobile/src/services/classes.ts` has zero offline-queue code today and this story keeps it that way.
- `book_class_session()`/`cancel_class_booking()` (and the two new RPCs) are **not** covered by Story 11.4's `tenant_active_gate` RESTRICTIVE policy (a documented, pre-existing gap logged in `deferred-work.md` — every `SECURITY DEFINER` write RPC in this schema bypasses it, not something introduced or fixable by this story). A suspended gym's member could technically still book/cancel a class via these RPCs. Out of scope here — do not attempt to close this gap as a drive-by fix.

### Existing Files to Read Before Writing New Ones

- `apps/mobile/src/services/classes.ts` (full file, ~75 lines) — the exact typed-result-union (`BookClassSessionResult`/`CancelClassBookingResult`), try/catch, never-throw shape this story's two new list functions must sit alongside (using `payments.ts`'s `T[] | null` shape instead, per Task 2 — this file will end up with two different result conventions side by side, which is correct: actions vs. lists have different needs, not an inconsistency to "fix").
- `apps/mobile/src/services/payments.ts`'s `loadPaymentsPage()` — the `T[] | null` list-load contract to copy for `listBookableClassSessions()`/`listMyClassBookings()`.
- `apps/mobile/src/services/checkin.ts` — the original typed-result-union/never-throw precedent Story 12.2 already copied for the two action wrappers.
- `apps/mobile/src/app/(tabs)/history/index.tsx` (full file, 617 lines) — `SegmentedControl` usage, `FlatList`/pull-to-refresh/pagination shape, the closest structural precedent for the new `classes/index.tsx`.
- `apps/mobile/src/app/(tabs)/index.tsx` (full file) — `loadHome()`'s best-effort-parallel-fetch pattern (`occupancyBand`/`taraMoneyConnected`), the `requestIdRef`/`isCurrent()` stale-response guard, and exactly where in the JSX the new Upcoming Classes section slots in (mockup: after quick actions, before Recent Activity).
- `apps/mobile/src/app/(tabs)/profile.tsx` (full file) — the `profile.bodyProfile` row's exact `View`/`Pressable`/style shape to copy for the new History row.
- `apps/mobile/src/lib/offline-sync-context.tsx` (full file, 143 lines) — `useOfflineSync().isConnected` is a plain read, already exists, no changes needed here.
- `apps/mobile/src/components/app-tabs.tsx` / `app-tabs.web.tsx` (both full files) — the exact trigger lists Task 4 edits.
- `apps/mobile/AGENTS.md` — mandatory Expo v57 doc-verification instruction before touching any Native Tabs code.
- `supabase/migrations/0058_class_booking_with_capacity_enforcement.sql` — `book_class_session()`/`cancel_class_booking()`'s member-resolution block, copied verbatim by both new RPCs in Task 1.
- `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` — MA-09 (Home, lines 580–649, Upcoming Classes section spec), MA-16 (Classes, lines 943–984, full screen spec), Navigation Structure (lines 116–187, the 5-tab target and History-move rationale).

### Testing Requirements

- Follow `class_booking_with_capacity_enforcement.test.sql`'s pgTAP fixture conventions exactly (deterministic UUIDs, `transaction`, `plan(...)`, `finish()`, rollback).
- **Highest-risk regression to prove:** `list_bookable_class_sessions()`'s `booked_count` must reflect *every* member's bookings on a session, not just the caller's — a copy-paste that accidentally scopes the inner `count(*)` by `member_id` would silently make every session look under-capacity to every member. Use ≥2 distinct fixture members booked on the same session to catch this.
- No mobile automated test coverage exists anywhere in this app (pre-existing, documented gap since Story 10.3) — pgTAP is the only automated coverage for this story's new logic; the mobile UI is manual-verification-only, same as every prior mobile story.
- Full regression gate: clean `supabase db reset`, all pgTAP tests, generated-types diff inspection, monorepo typecheck, lint, `check:i18n`.

### Project Structure Notes

- New migration: `supabase/migrations/0078_member_app_classes_surfaces.sql`.
- New screen: `apps/mobile/src/app/(tabs)/classes/index.tsx`.
- Edited: `apps/mobile/src/services/classes.ts` (new `listBookableClassSessions()`/`listMyClassBookings()`, alongside Story 12.2's existing exports).
- Edited: `apps/mobile/src/app/(tabs)/index.tsx` (Upcoming Classes summary), `apps/mobile/src/app/(tabs)/profile.tsx` (new History row).
- Edited: `apps/mobile/src/components/app-tabs.tsx` (add `classes` trigger, remove `history` trigger), `apps/mobile/src/components/app-tabs.web.tsx` (add `classes` trigger).
- Edited: `apps/mobile/src/locales/en.json`/`fr.json` (new `classes.*` namespace, new keys under `home.*` and `profile.*`).
- New test: `supabase/tests/member_app_classes_surfaces.test.sql`.
- Updated generated type: `packages/types/src/database.ts`.
- Updated decision record: `docs/decisions.md`.
- **No changes** to `apps/dashboard`, `apps/super-admin`, `book_class_session()`, `cancel_class_booking()`, `mark_class_attendance()`, any Story 12.1–12.3 migration/RLS policy, or `apps/mobile/src/app/(tabs)/history/index.tsx`'s own internals (only its tab-bar trigger moves, not its content).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 12: Classes & Scheduling, Story 12.4]
- [Source: `_bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md` FR-105/FR-106 (booking/cancellation rules, reused unchanged), FR-108 (Home summary + Classes tab, workout-plans distinctness), FR-123 (Classes tab as a new bottom-tab item)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md` — AD-21 (booking/attendance RPC shapes, already resolved by 12.2/12.3), AD-23 (class booking excluded from the mobile offline queue)]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` — MA-09 Home (lines 580–649), MA-16 Classes (lines 943–984), Navigation Structure/tab-bar rationale (lines 116–187), Voice and Tone table (booking-race copy, line 252)]
- [Source: `_bmad-output/implementation-artifacts/12-2-class-booking-with-capacity-enforcement.md` — explicitly defers all member UI to this story; `services/classes.ts`'s existing shape/contract]
- [Source: `_bmad-output/implementation-artifacts/12-3-class-attendance-marking.md` — distinct-empty-state lesson, RLS-role-list-widening caution, `mark_class_attendance()`'s PostgREST NULL-composite-serialization bug as a general caution for any future composite-returning RPC (not directly reused here — this story's RPCs return `setof`/`table`, not a single composite row, so that specific bug class doesn't apply, but the general "check the real HTTP JSON shape, not just the SQL behavior" lesson does)]
- [Source: `_bmad-output/implementation-artifacts/10-3-member-progress-screen.md` — the explicit deferral of the History→Profile tab-bar move to this story; the exact native/web tab-bar-edit precedent]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — `tenant_active_gate`'s known non-coverage of class-booking RPCs (pre-existing, not this story's to fix); the coach-schedule-visibility gap flagged for a future `12.5` (out of scope, staff-facing not member-facing)]
- [Source: `supabase/migrations/0057_class_creation_scheduling.sql`, `0058_class_booking_with_capacity_enforcement.sql` — `classes`/`class_sessions`/`class_bookings` schema and RLS this story reads against, `book_class_session()`/`cancel_class_booking()` reused unchanged]
- [Source: `supabase/migrations/0038_member_app_payment_history_receipt_detail.sql` — `member_read_gym_staff_members`'s deliberate coach-role exclusion, the gap Task 1's RPC works around rather than widens]
- [Source: `supabase/migrations/0056_quiet_gym_alert_opt_in_delivery.sql` — `private.gym_occupancy_band()`, the aggregate-not-raw-rows precedent Task 1's two RPCs follow]

## Change Log

- 2026-08-31: Story drafted via create-story workflow. Next backlog story in Epic 12 (already in-progress); no epic status change needed. Central design decision: two new member-facing `SECURITY DEFINER` RPCs to bridge the gap between Stories 12.1–12.3's staff-oriented RLS and this story's browse/capacity/coach-name needs, without widening any existing policy. Confirmed via direct migration reading that the tab-bar's History→Profile move — explicitly deferred by Story 10.3 to "whichever story adds the Classes tab" — is this story's to complete.
- 2026-08-31: dev-story: status ready-for-dev -> in-progress -> review. All 7 tasks complete. Migration `0078_member_app_classes_surfaces.sql` (two new SECURITY DEFINER RPCs), `services/classes.ts` extended, new `(tabs)/classes/index.tsx` screen, tab-bar restructure (`app-tabs.tsx`/`app-tabs.web.tsx`, `profile.tsx`'s new History row), Home's Upcoming Classes summary, `member_app_classes_surfaces.test.sql` (10 new pgTAP assertions), `database.ts` hand-spliced with the two new RPC signatures, `docs/decisions.md` dated entry added. Full regression clean: pgTAP 1622/1622, typecheck 0 errors (4/4 packages), check:i18n clean. `pnpm run lint` could not run for `apps/mobile` — pre-existing environment gap (no `eslint` devDependency), confirmed identical on the pre-story baseline commit; dashboard/super-admin lint unaffected (no changes in this story's diff). See Completion Notes for full detail.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `npx supabase db reset` — applied `0078_member_app_classes_surfaces.sql` cleanly against the full existing migration chain.
- `npx supabase test db` — 75 files, 1622/1622 assertions pass (10 new, in `member_app_classes_surfaces.test.sql`; 1612 pre-existing unchanged).
- `npx supabase gen types typescript --local` — ran cleanly (no zero-byte-stdout bug this session); output diffed against the checked-in `database.ts`, and only the two new function entries (`list_bookable_class_sessions`/`list_my_class_bookings`) were hand-spliced in — the rest of the generator's output (a `graphql_public` block, `isOneToOne` flags, and other unrelated pre-existing gaps) was left out, out of scope per Story 12.3's own precedent.
- `pnpm run typecheck` — initially failed on 2 files (`(tabs)/index.tsx`, `app-tabs.web.tsx`) with `Type '"/classes"' is not assignable to type ...` — root cause: `apps/mobile/.expo/types/router.d.ts` (Expo Router's generated typed-routes file) was stale from before the `classes` route existed. Fixed by briefly starting `expo start` to regenerate it (no code change); typecheck then passed clean across all 4 packages.
- `pnpm run lint` — fails at the root (`apps/mobile`'s `expo lint` errors with `Command "eslint" not found`); reproduced identically via `git stash` against the pre-story baseline commit, confirming this is a pre-existing environment gap (`apps/mobile/package.json` has never listed `eslint`/`eslint-config-expo` as a devDependency despite `eslint.config.js` requiring both), not introduced by this story. `apps/dashboard`/`apps/super-admin` lint run clean in isolation (15/1 pre-existing warnings respectively, neither file touched by this story).
- `pnpm run check:i18n` — clean, 295 mobile keys (was 262), en/fr in parity.

### Completion Notes List

- Task 1: `0078_member_app_classes_surfaces.sql` adds `list_bookable_class_sessions()`/`list_my_class_bookings()`, both member-only `SECURITY DEFINER` RPCs following `book_class_session()`'s exact role-check/resolve-gym/resolve-member shape. No RLS policy changes — both functions deliberately bypass `class_bookings`'/`members`' existing restrictive read policies only for their own narrow, caller-scoped projections.
- Task 2: `services/classes.ts` extended with `listBookableClassSessions()`/`listMyClassBookings()`, following `payments.ts`'s `T[] | null` list-load contract (distinct from this same file's existing `bookClassSession()`/`cancelClassBooking()` typed-result-union contract — both conventions now coexist in this file by design, actions vs. lists having different needs).
- Task 3: New `(tabs)/classes/index.tsx` screen — segmented Available/My Bookings control (initial tab read from the `tab` route param), independent per-tab load/error/busy state with `requestIdRef` stale-response guards, lazy-loads the inactive sub-tab on first activation (mirrors `history/index.tsx`'s Payments tab). Book/Cancel both optimistic with per-row busy indicators; a lightweight local toast (no shared toast primitive existed anywhere in this app, so a small self-contained one was added, scoped to this screen only) surfaces the race-lost/ineligible/generic-error copy. Offline banner reads `useOfflineSync().isConnected`, disables both actions, never attempts the RPC while offline.
- Task 4: `app-tabs.tsx`'s `history` `NativeTabs.Trigger` removed, `classes` added between `checkin`/`progress` (`sf="calendar"`/`md="event"`, both verified present in the installed `sf-symbols-typescript`/`expo-symbols` type packages per `apps/mobile/AGENTS.md`'s v57-doc-verification requirement). `app-tabs.web.tsx` gains a matching `classes` trigger (its own pre-existing 4-trigger set already had no `history` entry, untouched). `profile.tsx` gains a new History row, styled after the existing `bodyProfile` row. `history/index.tsx` itself is unchanged — reachable via `router.push('/history')`, the same non-tab-trigger-route shape `progress/entries.tsx` already proves works in this app; this specific mechanical claim could not be device/browser-verified this session (see below).
- Task 5: `(tabs)/index.tsx`'s `loadHome()` gains a best-effort, non-blocking `listMyClassBookings()` call (own local try/catch, same treatment as `occupancyBand`/`taraMoneyConnected`), rendering a new Upcoming Classes section (top 2 results) between quick actions and Recent Activity, absent entirely when empty (not an empty state, per AC #1's explicit mockup requirement).
- Task 6: `member_app_classes_surfaces.test.sql`, 10 pgTAP assertions covering both RPCs' role checks, the booked-count aggregate across 2 distinct members on one session, coach-name resolution, `my_booking_id`'s both null/matching states, chronological ordering with past-session and cross-gym exclusion proven together, and `list_my_class_bookings()`'s only-own/past-exclusion/mismatched-gym-row exclusion (the latter two proven via deliberately forced fixture rows bypassing the normal booking flow, since `book_class_session()` itself would reject both).
- Task 7: `database.ts` updated (scoped, hand-spliced diff — see Debug Log). `docs/decisions.md` dated entry added covering the 4 required design points. Full regression run — see Debug Log for the one real fix required (stale Expo Router typed-routes cache) and the one disclosed pre-existing gap (mobile lint).
- **Manual device/browser verification is this session's responsibility, not something this story could complete unattended** — no device/simulator or browser automation is available in this environment (same disclosure as every mobile story since Epic 9). Still needing a real pass: Home's Upcoming Classes summary appearing/disappearing correctly, Available/My Bookings loading real data, the Book/Cancel/race-lost/offline-banner states all rendering correctly, and the tab bar showing exactly 5 triggers with History reachable from the new Profile row.

### File List

- `supabase/migrations/0078_member_app_classes_surfaces.sql` (new)
- `supabase/tests/member_app_classes_surfaces.test.sql` (new)
- `apps/mobile/src/app/(tabs)/classes/index.tsx` (new)
- `apps/mobile/src/services/classes.ts` (edited)
- `apps/mobile/src/app/(tabs)/index.tsx` (edited)
- `apps/mobile/src/app/(tabs)/profile.tsx` (edited)
- `apps/mobile/src/components/app-tabs.tsx` (edited)
- `apps/mobile/src/components/app-tabs.web.tsx` (edited)
- `apps/mobile/src/locales/en.json` (edited)
- `apps/mobile/src/locales/fr.json` (edited)
- `packages/types/src/database.ts` (edited)
- `docs/decisions.md` (edited)
