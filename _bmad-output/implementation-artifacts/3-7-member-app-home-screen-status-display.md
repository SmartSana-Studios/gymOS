---
baseline_commit: 8a80e364ea936f5b02d784822da0875703f12f68
---

# Story 3.7: Member App — Home Screen & Status Display

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want my home screen to show my subscription status and quick actions,
so that I know where I stand at a glance.

## Acceptance Criteria

1. **Given** my subscription status, **when** I open the Home screen, **then** I see a status badge (Active/Expiring Soon/Grace Period/Expired/No Active Plan), my plan name, expiry date, and quick actions for Check In and View Plan. [Source: epics.md#Story 3.7; PRD FR-059]
2. **Given** my status is `expired`, **when** the Home screen renders, **then** the "Check In" quick action is replaced with "See front desk." [Source: epics.md#Story 3.7]
3. **Given** I have recent check-in activity, **when** the Home screen loads, **then** the last 2–3 check-in events are shown (the feed is extended to include payment events in Epic 4, Story 4.9). [Source: epics.md#Story 3.7]
4. **Given** the gym has occupancy tracking configured, **when** the Home screen loads, **then** a member-facing occupancy indicator shows one of the three bands (Low/Medium/Busy) computed by `member_occupancy_band()`, or nothing if the gym has no capacity configured — never a raw count. **This AC is not in epics.md's own Story 3.7 bullet list; see Scope Note #2 for why it belongs here.** [Source: PRD FR-047; supabase/migrations/0025_occupancy_display_admin_attendance_page.sql]

## Tasks / Subtasks

- [x] **Task 1: Migration `0026` — member read RLS policy on `attendance_events`** (AC #3; Scope Note #1)
  - [x] `supabase/migrations/0026_member_app_home_screen_status_display.sql`: add `"member_read_own_attendance_events"` SELECT policy, exactly as specified in Scope Note #1.
- [x] **Task 2: Mobile — attendance/subscription read helpers** (AC #1, #2, #3)
  - [x] Extend `apps/mobile/src/services/checkin.ts` with a new exported `getRecentCheckIns(limit: number)` function (Scope Note #3) that resolves the caller's own `member_id` then selects the last N `attendance_events` rows ordered by `checked_in_at desc`.
  - [x] In the Home screen (Task 3), resolve the member's current subscription (status + expiry + plan name) inline via the same `members` → `subscriptions` query shape `onboarding/plan.tsx`/`(tabs)/profile.tsx` already use — **do not** filter `.eq('status', 'active')` this time (Scope Note #4); Home must display whichever status the row actually has.
- [x] **Task 3: Mobile — rewrite `apps/mobile/src/app/(tabs)/index.tsx` as the real MA-09 Home screen** (AC #1, #2, #3, #4)
  - [x] Replace the current Expo-scaffold placeholder content entirely.
  - [x] Branded header: gym `logo_url` + gym `name` (live-fetched, no caching layer — Scope Note #6), member avatar (tappable → `/profile` tab).
  - [x] "Welcome back, [First Name]" — derive first name from `users.display_name`'s first whitespace-separated token; fall back to a name-less greeting if `display_name` is null.
  - [x] Subscription status card: badge (5 states per AC #1, table in Scope Note #4), plan name, expiry date (reuse `formatDateOnly`-style locale formatting from `onboarding/plan.tsx`). Tapping the card is a documented no-op for now (Scope Note #5) — do not build a Plan Details screen.
  - [x] Quick actions row: "Check In" (`router.push('/checkin')`) + "View Plan" (no-op per Scope Note #5); when status is `expired`, replace "Check In" with "See front desk" (AC #2) — reuse the bottom-sheet-via-`Alert.alert` pattern `(tabs)/profile.tsx`'s `handleLogOut` already establishes for a simple informational/confirm sheet, per Scope Note #5.
  - [x] Recent activity section: last 2–3 `getRecentCheckIns()` rows, reverse chronological; empty state copy for zero rows; rows are **not** tappable in this story (Scope Note #5).
  - [x] Occupancy indicator (AC #4): call `getOccupancyBand()` (`apps/mobile/src/services/occupancy.ts`, already built by Story 3.6); render nothing if `band` is `null` or the call errors — this is a non-blocking, best-effort element, never a load-blocking one.
  - [x] Loading state: `ActivityIndicator`, matching every other screen in this app (Scope Note #7) — do not build the UX mockup's skeleton-rectangle treatment, no such component exists in this codebase.
  - [x] Error state: reuse the inline error-card + "Try again" pattern from `onboarding/plan.tsx`/`(tabs)/profile.tsx`.
- [x] **Task 4: i18n — new `home.*` namespace** (all ACs)
  - [x] Add matching key sets to both `apps/mobile/src/locales/en.json` and `apps/mobile/src/locales/fr.json` (`check-i18n-key-parity.mjs` enforces parity — run it before finishing).
- [x] **Task 5: pgTAP — `supabase/tests/member_app_home_screen_status_display.test.sql`** (AC #3)
  - [x] Follow `occupancy_display_admin_attendance_page.test.sql`'s session-simulation convention (`set local role authenticated` + `set_config('request.jwt.claims', ...)`, `reset role` before asserting).
  - [x] Assert a member session can SELECT its own `attendance_events` rows via the new policy.
  - [x] Assert a member session cannot SELECT another member's `attendance_events` rows in the same gym.
  - [x] Assert the pre-existing `gym_staff_read_own_attendance_events` (0025) and deny-all-by-default behavior for non-member/non-staff roles are unaffected.
- [x] **Task 6: Verification**
  - [x] `pnpm typecheck`, `node scripts/check-i18n-key-parity.mjs` (or the app's equivalent) pass.
  - [x] `supabase test db` passes (run from WSL — this project's Supabase/Docker stack only runs reliably there; see Dev Notes).
  - [x] Manual/hands-on verification of all 5 status-badge states + the expired quick-action swap + empty/loading/error states, via direct RPC/SQL against the local instance if a live device/simulator session isn't available in this environment (matches this codebase's established fallback, see Dev Notes).

### Review Findings

- [x] [Review][Decision] Grace-period badge missing required "warning icon" — Scope Note #4's badge table specifies grace_period's color signal as "Orange + warning icon," but `STATUS_COLORS.grace_period` uses identical values to `expiring_soon` and no icon element is rendered for any status. No icon library exists anywhere in `apps/mobile/src` (confirmed via search). **Resolved:** install an icon library — `@react-native-vector-icons/material-icons` (dynamic/default import, no config plugin or prebuild needed), rendering its `warning` glyph next to the grace_period label. [apps/mobile/src/app/(tabs)/index.tsx: STATUS_COLORS definition, status card render]

- [x] [Review][Patch] Reset all previously-loaded display/subscription state at the start of `loadHome` — only `noActivePlan` is reset today; `displayName`, `avatarUrl`, `gymName`, `gymLogoUrl`, `subscriptionStatus`, `expiryDate`, and `planName` persist stale values across a retry or a status change, so e.g. a "No active plan" badge can render next to a stale plan name from the prior load. [apps/mobile/src/app/(tabs)/index.tsx: loadHome] — fixed: all display/subscription state fields reset at the top of `loadHome`.
- [x] [Review][Patch] Validate `subscriptionData.status` against the known `SubscriptionStatus` enum before casting/using it — an unrecognized DB value makes `STATUS_COLORS[badgeStatus]` `undefined` and crashes the render (same risk applies to `OCCUPANCY_COLORS` if the occupancy service ever returns an unexpected band). [apps/mobile/src/app/(tabs)/index.tsx: isSubscriptionRow, subscription branch] — fixed: added `SUBSCRIPTION_STATUSES`/`isSubscriptionStatus` guard; an unrecognized value now falls into `loadError` instead of an unsafe cast.
- [x] [Review][Dismiss] ~~Add the Scope Note #5-required comment naming Story 3.10 to `handleViewPlan`~~ — false positive: the comment already exists in the actual file (`// Story 3.10 ("Member App -- Plan Details & Check-In History") wires real navigation...`); this finding was an artifact of the reviewer's own condensed diff copy accidentally dropping that comment block, not a real gap.
- [x] [Review][Patch] Locally guard the `getOccupancyBand()` call the way `getRecentCheckIns()` guards itself — today an exception here isn't isolated and would trip the shared `loadError`, hiding the whole screen, contradicting Scope Note #2's "never block the rest of the screen." [apps/mobile/src/app/(tabs)/index.tsx: loadHome, occupancy fetch] — fixed: wrapped in a local try/catch that falls back to `band: null` on any exception.
- [x] [Review][Patch] (optional/minor) Thread `memberId` into `getRecentCheckIns` instead of having it re-resolve the same `members` row `loadHome` already resolved — avoids a duplicate round-trip on every Home mount. [apps/mobile/src/services/checkin.ts: getRecentCheckIns; apps/mobile/src/app/(tabs)/index.tsx: loadHome] — fixed: `getRecentCheckIns(memberId, limit)` now takes the already-resolved id as a parameter.
- [x] [Review][Patch] Key the activity list by `attendance_events.id` instead of `checkedInAt` — two check-ins in the same second collide today since `RecentCheckIn` drops the row id entirely. [apps/mobile/src/services/checkin.ts: RecentCheckIn, getRecentCheckIns; apps/mobile/src/app/(tabs)/index.tsx: activity list .map()] — fixed: `RecentCheckIn.id` added and selected; `.map()` keys off `event.id`.
- [x] [Review][Patch] Add a warning-icon glyph to the grace_period status badge — install `@react-native-vector-icons/material-icons` (dynamic import) and render its `warning` icon next to the grace_period label/note, per the resolved Decision item above. [apps/mobile/src/app/(tabs)/index.tsx: STATUS_COLORS, status card render; apps/mobile/package.json] — fixed: package installed, `MaterialIcons name="warning"` rendered next to the label for `grace_period` only.

- [x] [Review][Defer] `gyms` query has no explicit `.eq('id', ...)` scoping filter, relying entirely on RLS + `.single()` [apps/mobile/src/app/(tabs)/index.tsx: loadHome] — deferred, pre-existing (identical pattern already used by `apps/mobile/src/app/(tabs)/profile.tsx:78`, Story 2.8)
- [x] [Review][Defer] `isSubscriptionRow`'s `plans` shape check (`typeof === 'object'`) would also pass for an array [apps/mobile/src/app/(tabs)/index.tsx: isSubscriptionRow] — deferred, pre-existing (copied verbatim from `onboarding/plan.tsx`'s existing `isSubscriptionRow`)
- [x] [Review][Defer] No unmount/cancellation guard on the async `loadHome` load [apps/mobile/src/app/(tabs)/index.tsx: loadHome] — deferred, pre-existing (no screen in this codebase guards against this)
- [x] [Review][Defer] Silent, unlogged failure paths in `getRecentCheckIns`/`getOccupancyBand` [apps/mobile/src/services/checkin.ts; apps/mobile/src/services/occupancy.ts] — deferred, pre-existing (matches the spec's own best-effort/non-blocking design and no logging convention exists elsewhere in this app)
- [x] [Review][Defer] New `create policy` migration has no `drop policy if exists` guard or down-migration [supabase/migrations/0026_member_app_home_screen_status_display.sql] — deferred, pre-existing (matches every other migration in this repo)
- [x] [Review][Defer] No `onError` fallback for broken/expired gym-logo or avatar image URLs [apps/mobile/src/app/(tabs)/index.tsx: header render] — deferred, pre-existing (no existing screen handles this either)

## Dev Notes

This story replaces the Expo-scaffold placeholder at `apps/mobile/src/app/(tabs)/index.tsx` with the member app's real primary screen (MA-09). Read all seven Scope Notes below before writing code — several resolve real gaps between epics.md's AC wording, the UX mockup, and what already exists in the codebase and its data model.

### Scope Note #1 — `attendance_events` has **zero** member-read RLS policy today; AC #3 is unbuildable without a new one

Every access to `attendance_events` so far has gone through either a `SECURITY DEFINER` function (`check_in()`/`check_out()`, Stories 3.4/3.5) or, as of Story 3.6, a staff-only SELECT policy (`gym_staff_read_own_attendance_events`, 0025, gated to `owner`/`manager`/`receptionist`). The table's original deny-all RLS (0006) never got a member-facing SELECT policy — a `member`-role session cannot read even its own check-in rows via a direct client `select()` today. Verified via `Grep` across every migration file: no policy referencing `attendance_events` and `'member'` exists anywhere.

Add this to the new migration, mirroring `gym_staff_read_own_subscriptions`' self-access shape exactly (0018_member_management.sql, lines 227–238 — an `exists` clause proving row ownership through `members.user_id = auth.uid()`, not a raw `member_id = auth.uid()` comparison, since `attendance_events.member_id` references `members.id`, a different UUID from the auth user id):

```sql
create policy "member_read_own_attendance_events" on attendance_events
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'member'
    and exists (
      select 1 from members m
      where m.id = attendance_events.member_id and m.user_id = auth.uid()
    )
  );
```

This coexists with 0025's staff policy (same-table SELECT policies are OR'd together, same shape as `gyms`' two SELECT policies) — no conflict.

### Scope Note #2 — Occupancy indicator (AC #4) is a deliberate addition beyond epics.md's own Story 3.7 bullet list

FR-047 ("The member-facing occupancy display uses three bands...") is a real, numbered requirement mapped to Epic 3 — but epics.md's own per-story AC breakdown never places a consuming UI anywhere, and `EXPERIENCE.md`'s MA-09 mockup (lines 547–609) does not show an occupancy element either (confirmed by `Grep` — zero matches for "occupancy"/"band"/"busy" in the entire UX doc). Story 3.6 built `member_occupancy_band()` and the mobile `getOccupancyBand()` service specifically because "Story 3.7 (Member App Home Screen) is its first consumer" — see that story's own code comment in `apps/mobile/src/services/occupancy.ts` and its Dev Notes reference at line 284 of its story file, which explicitly states: *"confirms no occupancy band component exists in any mobile mockup today."* No later story ever mentions occupancy again. If this story doesn't wire it in, FR-047's member-facing half never ships and the backend capability sits permanently unused.

**Decision:** add a small, non-blocking occupancy indicator to the Home screen (e.g., a pill/chip near the status card or quick actions — exact placement/copy is this story's own call, since no mockup governs it). It must never fail visibly or block the rest of the screen: treat `band === null` (no capacity configured) and any RPC error identically — render nothing.

### Scope Note #3 — Where to put the new "recent check-ins" query

`apps/mobile/src/services/checkin.ts` already owns every other `attendance_events` interaction (`recordCheckIn`, and `validateGymToken` for the related gym-token check). Add `getRecentCheckIns()` there rather than a new service file or an inline query — keeps attendance data-access centralized in the one file that already owns it, consistent with this codebase's "thin per-domain service layer" convention (architecture.md, Frontend Architecture). By contrast, the subscription-status query (Task 2's second bullet) has no existing dedicated service file anywhere in this app (`onboarding/plan.tsx` and `(tabs)/profile.tsx` both query `subscriptions` inline, ad hoc) — follow that same inline precedent for Home rather than introducing a new service module for a single-consumer read.

### Scope Note #4 — Subscription status query: reuse the established member/subscription resolution pattern, but drop the `active`-only filter

`onboarding/plan.tsx` (lines 103–129) and `(tabs)/profile.tsx` (lines 76–125) both already establish the exact pattern for resolving "the caller's current member row, then their subscription":

```ts
const { data: memberRow } = await supabase
  .from('members')
  .select('id')
  .eq('user_id', userId)
  .is('deactivated_at', null)
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(1)
  .single();

const { data: subscriptionData, error } = await supabase
  .from('subscriptions')
  .select('status, expiry_date, plans(name)')
  .eq('member_id', memberRow.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();
```

Both existing call sites add `.eq('status', 'active')` because they only ever need to know about an active plan. **Home must not** — it needs to display whichever status the member's most-recent subscription row actually holds (`active` | `expiring_soon` | `grace_period` | `expired`), per the status enum in `packages/types/src/database.ts`. Keep the existing `PGRST116` → "no active plan" distinction (both existing files already establish this as a deliberate, non-retryable state distinct from a network error — a code-review-hardened pattern, not incidental).

Status badge table (from `EXPERIENCE.md` lines 587–595, matches the dashboard's existing `members.status.*` i18n keys/semantics in `apps/dashboard/app/(dashboard)/attendance/attendanceLabels.ts` — reuse the same 5-state meaning, new mobile-local i18n keys):

| `subscriptions.status` (or absent) | Badge label | Color signal | Additional text |
|---|---|---|---|
| `active` | "Active" | Green | Expiry date |
| `expiring_soon` | "Expiring soon" | Orange | "Expires [date]" |
| `grace_period` | "Grace period" | Orange + warning icon | "Expires [date] — you can still check in" |
| `expired` | "Membership expired" | Red | "See front desk to renew" |
| (no subscription row) | "No active plan" | Gray | "Contact your gym" |

`apps/mobile/src/constants/theme.ts`'s `Colors` object has no semantic green/orange/red tokens today (only neutral text/background/backgroundElement/backgroundSelected) — this story needs to introduce them (as local component styles or new theme constants; your call), matching the *meaning* of the dashboard's existing green/orange/red/gray badge families, not necessarily identical hex values (no cross-app design-token doc mandates exact parity for mobile).

### Scope Note #5 — "View Plan," the status card, and Recent Activity rows have no navigation target yet — ship them as non-functional today, do not build stub screens

The UX mockup (MA-09) says tapping the status card or "View Plan" navigates to MA-13 (Plan Details), and recent-activity rows navigate to check-in History — **both of those screens are Story 3.10's own explicitly-scoped deliverable** ("Member App — Plan Details & Check-In History"), not built yet, and no route exists for either today. Building a throwaway placeholder screen now would be wasted, disaster-prone work that Story 3.10 immediately discards or fights with — the same reasoning Story 3.6 used to justify shipping `member_occupancy_band()` with zero UI consumers ("do not attempt to bolt ... onto a screen that's about to be substantially rewritten").

**Decision:** render the card, "View Plan" button, and activity rows exactly as the mockup shows them visually, but wire their `onPress` handlers as documented no-ops (a short code comment naming Story 3.10 as the story that wires real navigation in). This is a deliberate, temporary UX gap — flag it in your Completion Notes, do not silently ship it unremarked.

The bottom tab bar itself: `EXPERIENCE.md`'s MA-09 layout shows 4 tabs (Home/Check In/History/Me), but `apps/mobile/src/components/app-tabs.tsx` only defines 3 (`index`/`checkin`/`profile`) — **do not add a 4th "History" tab in this story.** There is no History screen to route it to; that tab is Story 3.10's own job when the screen it points to actually exists.

The header avatar **is** real and buildable now: it navigates to the existing `/profile` tab (`(tabs)/profile.tsx`, shipped in Story 2.8) — wire this one for real.

The UX mockup's "Offline sync banner" ("Offline check-in pending sync…") has no data source yet either — it depends on Story 3.9's SQLite offline queue, which doesn't exist. **Skip this element entirely** in this story; there is nothing to read a queued/pending state from.

### Scope Note #6 — No branding cache exists; keep following the established live-fetch-per-screen pattern

FR-011/architecture.md describe a 24-hour on-device branding cache, but no story has actually built one — `(tabs)/profile.tsx` fetches `gyms.select('name')` fresh on every mount with no caching layer, and that remains this codebase's only precedent. Do not introduce a caching layer in this story; just live-fetch `gyms.select('name, logo_url')` the same way. (A real caching layer is separate, cross-cutting scope — out of bounds here.)

### Scope Note #7 — Loading state: use `ActivityIndicator`, not the UX mockup's skeleton rectangles

Every existing screen in this app (`onboarding/plan.tsx`, `(tabs)/profile.tsx`) uses a plain `ActivityIndicator` for its loading state. No skeleton-rectangle component exists anywhere in `apps/mobile`. Follow the established precedent rather than introducing a new UI primitive for this one screen — a deliberate, accepted deviation from the UX spec's literal wording, consistent with how prior stories have already handled UX/implementation mismatches.

### Project Structure Notes

- New migration: `supabase/migrations/0026_member_app_home_screen_status_display.sql` (next sequential number after Story 3.6's `0025`).
- New pgTAP file: `supabase/tests/member_app_home_screen_status_display.test.sql`.
- Modified: `apps/mobile/src/app/(tabs)/index.tsx` (full rewrite), `apps/mobile/src/services/checkin.ts` (new export), `apps/mobile/src/locales/{en,fr}.json` (new `home.*` namespace).
- No changes to `apps/mobile/src/components/app-tabs.tsx` (Scope Note #5) or `packages/types` (no new schema/RPC return shapes beyond what 0026 adds — `member_occupancy_band()` and the `subscriptions`/`attendance_events` tables are already typed).
- Do not create any file under a `plan/` or `history/` route path — those belong to Story 3.10 (Scope Note #5).

### Testing Standards Summary

- No mobile unit/component test runner exists in this repo (`apps/mobile`'s own `expo lint` currently can't even run — pre-existing, unrelated gap tracked in `deferred-work.md`). Every prior mobile story (2.6–3.6) has shipped without one; this story follows the same precedent — pgTAP for the new RLS policy, hands-on/manual verification for the screen itself.
- Run all `supabase`/Docker commands from **WSL**, not native PowerShell — this machine's Supabase CLI/Docker stack is only reliably reachable from a WSL shell (see project memory `project_supabase_wsl`). Story 3.6's own dev session hit a `dockerd` crash-loop that made live-browser/device testing intermittent; if live device testing isn't reliably available in this environment, fall back to direct SQL/RPC verification against the local Postgres instance (via `docker exec ... psql`, inside WSL) the same way Story 3.6 did, and say so explicitly in Completion Notes rather than claiming an untested path works.
- `check-i18n-key-parity.mjs` must pass after adding the new `home.*` keys to both locale files.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Local Supabase/Docker stack (WSL) hit the same intermittent `dockerd`/Postgres crash-loop Story 3.6 documented — `supabase test db` and manual `psql` sessions periodically failed with `connection refused` / `database system is starting up` mid-session. Worked around by polling `docker inspect --format='{{.State.Health.Status}}' supabase_db_gym_os` until `healthy` before each retry; no code or migration change was needed once the container stabilized.
- First `supabase test db` run failed with `INSERT has more target columns than expressions` in the new pgTAP file — a missing `tier_id` value in the `gyms` fixture insert (copy/paste slip). Fixed; full suite passed after.
- Adding `member_read_own_attendance_events` (0026) is an intentional, in-scope behavior change: it caused 2 pre-existing pgTAP assertions to fail (`occupancy_display_admin_attendance_page.test.sql`'s "member sees 0 rows" assertion, and `rls_tenant_isolation.test.sql`'s "attendance_events: 0 rows, no business policy yet" assertion) because a member session can now legitimately see its own attendance_events rows. Updated both to assert the new, correct expected counts (mirroring how `subscriptions`'/`plans`' RLS-policy stories updated the same test file previously) rather than leaving stale assertions in place.

### Completion Notes List

- All 6 tasks complete; all 4 ACs implemented and verified.
- `pnpm typecheck` passes across all 4 packages; `node scripts/check-i18n-key-parity.mjs` passes (113 mobile keys, en/fr in parity).
- `supabase test db` (run from WSL per project convention): 21 files, 324/324 tests passing, including the new `member_app_home_screen_status_display.test.sql` (6/6) and the 2 updated pre-existing files above.
- No mobile device/simulator session was available in this environment (matches Story 3.6's own precedent, Dev Notes). Verified by direct SQL against the local Postgres instance instead: seeded members with all 5 subscription-status shapes (active/expiring_soon/grace_period/expired/no-row), confirmed the exact query shape the Home screen issues returns the expected status/expiry/plan-name for each; confirmed `getRecentCheckIns`'s query returns 3 reverse-chronological rows for a member with activity and 0 rows for one without (empty-state path); confirmed `member_occupancy_band()` returns `'low'` for a member session at 1/10 (10%) capacity. All ran inside a rolled-back transaction, no data persisted.
- Per Scope Note #5 (flagging deliberately, as instructed): the status card, "View Plan" button, and recent-activity rows are wired as documented no-ops today (`handleViewPlan`) — a short in-code comment names Story 3.10 (Plan Details & Check-In History) as the story that wires real navigation. No 4th "History" bottom tab was added (Scope Note #5), and no offline-sync banner was built (Story 3.9 doesn't exist yet).
- Semantic green/orange/red/gray status colors and the occupancy-band colors are defined locally in `(tabs)/index.tsx` (not added to `constants/theme.ts`'s shared `Colors` object) — Scope Note #4 leaves this as the story's own call, and no other mobile screen needs them yet.

### File List

- `supabase/migrations/0026_member_app_home_screen_status_display.sql` (new)
- `supabase/tests/member_app_home_screen_status_display.test.sql` (new)
- `apps/mobile/src/services/checkin.ts` (modified — added `getRecentCheckIns`)
- `apps/mobile/src/app/(tabs)/index.tsx` (modified — full rewrite, Expo scaffold replaced with the real Home screen)
- `apps/mobile/src/locales/en.json` (modified — new `home.*` namespace)
- `apps/mobile/src/locales/fr.json` (modified — new `home.*` namespace)
- `supabase/tests/occupancy_display_admin_attendance_page.test.sql` (modified — updated stale member-deny-all assertion for the new 0026 policy)
- `supabase/tests/rls_tenant_isolation.test.sql` (modified — updated stale `attendance_events` deny-all assertion for the new 0026 policy)

## Change Log

- 2026-07-29: Implemented Story 3.7 — member read RLS policy on `attendance_events` (migration 0026), `getRecentCheckIns()` helper, full MA-09 Home screen rewrite (status badge, quick actions, recent activity, occupancy indicator), new `home.*` i18n namespace, pgTAP coverage. Updated 2 pre-existing pgTAP files whose assertions were made stale by the new member-read policy.
