---
baseline_commit: 909f7fe
---

# Story 3.6: Occupancy Display & Admin Attendance Page

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Gym Owner, Manager, or Receptionist,
I want to see current occupancy and a filterable attendance log,
so that I understand gym activity in real time.

## Acceptance Criteria

1. **Given** the gym's configured capacity and current checked-in count, **when** occupancy is calculated, **then** the member-facing app shows one of three bands (Low <30%, Medium 30–70%, Busy 71–100%), never raw counts or a "Full" state. [Source: epics.md#Story 3.6; PRD FR-046/FR-047]
2. **Given** the Attendance dashboard page, **when** I view it, **then** I see currently checked-in members, today's attendance count, and a check-in/check-out log filterable by date and member. [Source: epics.md#Story 3.6; PRD FR-048]

## Scope Notes — Read Before the Tasks

This story touches four surfaces: a new RLS policy + a member-facing occupancy function (backend), the dashboard's brand-new `/attendance` route (AD-11, the bulk of the work), a small mobile service function (backend-only, no UI), and two error-mapping/i18n additions. Read all seven notes below before writing any code — several resolve real gaps between the epics.md AC wording, the UX mockups, and what already exists in the codebase.

### Scope Note #1 — `attendance_events` has deny-all RLS with zero policies; this story adds the first staff read policy

Every access to `attendance_events` so far (`check_in()` 0023, `check_out()`/`check_out_member()` 0024, `run_check_in_auto_timeout_job()` 0024) goes through a `SECURITY DEFINER` function — the table itself has had RLS enabled with **zero policies** since 0006 (deny-all). This story is the first to need a plain filterable/paginated **read** (`.select()...range()...count`), which a `SECURITY DEFINER` function can't ergonomically provide (no PostgREST `.range()`/`.order()`/`count: "exact"` support inside plpgsql). Add a genuine RLS SELECT policy instead, mirroring `gym_staff_read_own_members`'s exact shape (`0018_member_management.sql:167-172`):

```sql
create policy "gym_staff_read_own_attendance_events" on attendance_events
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );
```

**No `coach` in the role array** — unlike `gym_staff_read_own_members` (which includes `coach` for the Coach Portal's own member-list needs), EXPERIENCE.md's Role visibility matrix (line 187-193, cited by Story 3.5) explicitly excludes Coach from Attendance. This also matches the Sidebar's existing `/attendance` nav entry (`components/shared/Sidebar.tsx:41`), already scoped to `["receptionist", "manager", "owner"]` — that nav entry was scaffolded ahead of this story and currently 404s; this story is what makes it resolve.

Table-level grants already exist (`grant select, insert, update, delete on attendance_events to authenticated, service_role`, 0006) — only the RLS policy is missing.

### Scope Note #2 — Member-facing occupancy band: build the backend capability now, no consuming screen exists yet

Epics.md's AC #1 is this story's own literal requirement, but the mobile Home screen it would render on (**MA-09**, EXPERIENCE.md line 547) has not been built — `apps/mobile/src/app/(tabs)/index.tsx` is still the unmodified Expo starter template today, and **Story 3.7 (Member App — Home Screen & Status Display)** is the story that actually constructs MA-09 for real. Story 3.7's own epics.md AC never mentions occupancy either — this is a genuine gap between the epics/PRD and the UX design, not a mistake in either document (checked EXPERIENCE.md and DESIGN.md exhaustively: no occupancy band component appears on any MA screen anywhere).

Resolve it the same way Story 3.1/3.2 (and 3.5's `check_out()`) resolved an analogous gap: **ship the backend capability now, with no UI consumer in this story.** Do **not** attempt to bolt an occupancy widget onto `index.tsx`'s current placeholder content — it will be substantially rewritten the moment Story 3.7 builds the real MA-09, and building real UI on top of Expo boilerplate that's about to be discarded is wasted, disaster-prone work.

**Critical security requirement (FR-047's own wording): the raw count and capacity must never reach the member client, in any form, ever** — not even transiently in a response that the UI happens not to render. Compute the band **entirely server-side** in a new `SECURITY DEFINER` Postgres function that returns only the band label (`'low' | 'medium' | 'busy' | null`), mirroring `check_in()`/`check_out()`'s self-role-check shape:

```sql
create function member_occupancy_band()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_capacity integer;
  v_checked_in_count integer;
  v_pct numeric;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select capacity into v_capacity from gyms where id = v_gym_id;
  -- Capacity is nullable (gyms.capacity, 0002) -- a gym that hasn't set
  -- capacity in Settings yet has no computable band. Return null rather
  -- than raising: this is an expected, non-error state, not a failure.
  if v_capacity is null or v_capacity <= 0 then
    return null;
  end if;

  select count(*) into v_checked_in_count
  from attendance_events
  where gym_id = v_gym_id and checked_out_at is null;

  v_pct := (v_checked_in_count::numeric / v_capacity) * 100;

  if v_pct < 30 then
    return 'low';
  elsif v_pct <= 70 then
    return 'medium';
  else
    return 'busy';
  end if;
end;
$$;

revoke execute on function member_occupancy_band() from public;
grant execute on function member_occupancy_band() to authenticated;
```

**Band boundaries, resolving an FR-047 gap:** the FR's table only defines Low/Medium/Busy up to 90% and says the 91%+ "Full" state is admin-only, "never in the member app" — it does not say what the member app shows at 91%+. Since the member app has only three bands and no fourth state to fall back to, `>70%` (inclusive of 91%+) resolves to `'busy'` here — the member never sees a distinct "Full" state, matching the FR's explicit "never [Full] in the member app" instruction literally. AC #1 above is written as "Busy 71–100%" to reflect this resolved range (the epics.md AC's own "71-90%" wording is copied from FR-047's admin-only table and doesn't leave room for 91-100% at all — this closes that gap).

Add the mobile service function that calls it (new file, no existing `apps/mobile/src/services/occupancy.ts`):

```ts
// apps/mobile/src/services/occupancy.ts
import { supabase } from '@/lib/supabase';

export type OccupancyBand = 'low' | 'medium' | 'busy';

export async function getOccupancyBand(): Promise<{ band: OccupancyBand | null; error: string | null }> {
  const { data, error } = await supabase.rpc('member_occupancy_band');
  if (error) {
    return { band: null, error: error.message };
  }
  return { band: (data as OccupancyBand | null) ?? null, error: null };
}
```

(Check `apps/mobile/src/services/checkin.ts` for this app's actual Supabase client import path/error-shape convention before writing this — copy its established pattern rather than inventing a new one.) **This function is called by no screen in this story** — Story 3.7 is its first consumer, exactly matching `check_out()`'s own "ship now, unused until a later story" precedent. Do not create or modify any file under `apps/mobile/src/app/`.

### Scope Note #3 — The dashboard Attendance page (AD-11): what's in the wireframe vs. what the epics.md AC actually requires

EXPERIENCE.md's AD-11 mockup (line 1211-1245) and epics.md's AC #2 don't line up 1:1. Resolve as follows:

- **Front-Desk Alert Panel** (AD-11's own top component, "identical to AD-02, real-time"): **out of scope.** This is FR-049-052's retention-trigger alert feature, owned by **Epic 4 Story 4.6** (architecture.md's own FR-table row: `Retention Triggers / front-desk alert (FR-049–052) → components/shared/FrontDeskAlertPanel.tsx ... Realtime channel gym:<gym_id>:alerts`). Do not build `FrontDeskAlertPanel.tsx` or any Realtime channel subscription in this story.
- **"Currently Checked-In table: refreshes via Supabase Realtime"** (AD-11's own wording): no Realtime channel exists anywhere in this codebase yet (grep confirmed) — it's architecturally scoped only to the alert-panel feature above. The same wireframe also shows an explicit **`[Refresh]`** button next to the table header. Build the manual-refresh path only: a `[Refresh]` button that calls `router.refresh()` (the same re-fetch mechanism `MembersPageClient`'s modals already use after a mutation), not a Realtime subscription. This is the "polling/manual degrade path" architecture.md already describes as the accepted fallback when Realtime isn't wired up.
- **"Today's attendance count"** (epics.md's own AC #2 wording): **not shown anywhere in AD-11's wireframe.** Add it as a simple stat line next to the "Currently Checked In (N members)" header — e.g. `Currently Checked In (N members) · Today: N check-ins [Refresh]` — no new stat-card component needed; AD-02's 3-card stat row is a different, out-of-scope page (see below).
- **AD-02 (Overview)** — the dashboard's actual home page (`apps/dashboard/app/(dashboard)/page.tsx`), which today is still the Story-1.8 placeholder ("Your gym's activity summary will appear here…") — is a **different page, out of scope for this story.** Its stat-cards row ("Checked in now: N", "Expiring this week: N", "Revenue MTD"), its own mini Currently-Checked-In table, and its Front-Desk Alert Panel are not this story's AC and are not mentioned in epics.md Story 3.6. Do not modify `apps/dashboard/app/(dashboard)/page.tsx`.

### Scope Note #4 — Date boundaries: UTC calendar day, not `gyms.timezone` (matches Story 3.1/3.2's documented, accepted gap)

"Today's attendance count" and the Daily Log's default date-range both need a "today" boundary. `gyms.timezone` (Africa/Douala default, UTC+1) exists as a column but **no query anywhere in this codebase actually uses it for date-boundary math** — `deferred-work.md` explicitly documents this as an accepted, pre-existing gap ("gyms.timezone is joined but unused in the date math"), reaffirmed by Story 3.2's own `renew_subscription()` comment (`0022_manual_renewal_reset.sql:60-64`). Follow that same precedent here: compute "today" as the server/DB's UTC calendar day (`new Date().toISOString().slice(0, 10)` in the Server Component, or `current_date`/`date_trunc('day', now())` in SQL) — do **not** introduce real per-gym timezone bucketing in this story; that would be new scope this story doesn't need and would make this one query newly inconsistent with every other date computation in the app.

### Scope Note #5 — `checkOutMember()` currently discards its own RPC result; fix it now that a real UI caller exists

Story 3.5 shipped `checkOutMember()` (`apps/dashboard/services/attendance.ts`) returning only `{ error }`, discarding the `attendance_events` row `check_out_member()` returns — `deferred-work.md` explicitly flagged this as "worth reconsidering once Story 3.6 builds the consuming Check Out button UI and needs the checkout timestamp to display." That story is this one. Update it to surface the timestamp:

```ts
export async function checkOutMember(
  memberId: string,
): Promise<{ data: { checkedOutAt: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_out_member", { p_member_id: memberId });
  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { checkedOutAt: data.checked_out_at }, error: null };
}
```

### Scope Note #6 — Map `check_out_member()`'s two raises now that a real UI needs friendly copy

Story 3.5 deliberately left `check_out_member()`'s raises unmapped in `packages/types/src/errors.ts` ("Story 3.6 adds the mapping once the dashboard's Check Out button needs a friendly message" — Scope Note #4 of that story). Add two new branches, following the file's existing `renew_subscription()` mapping pattern exactly (match on message substring, no pg error `code`):

```ts
// check_out_member()'s raises (0024/0025) -- unmapped until Story 3.6's
// dashboard Check Out button needed friendly copy for them.
if (message.includes("check_out_member:") && message.includes("not found")) {
  return { code: "member_not_found", message: copy.memberNotFound }; // reuse existing copy key
}

if (message.includes("has no open check-in")) {
  return { code: "no_open_check_in", message: copy.noOpenCheckIn }; // new copy key
}
```

Place these ahead of the final `unknown` fallback, alongside the existing `renew_subscription()` mappings. Add `noOpenCheckIn` to `packages/types/src/locales/{en,fr}.json`'s `errors` object (EN: `"This member doesn't have an open check-in to close."`; FR: `"Ce membre n'a pas de pointage ouvert à clôturer."`). `memberNotFound`'s copy already exists — reuse it, don't duplicate. The "has no open check-in" case is the real-world race Story 3.5's Review Findings already documented and deliberately deferred (the 15-minute auto-timeout cron closing a session in the same window a receptionist clicks Check Out) — this mapping is what finally gives that race a readable error message instead of the generic "unknown" fallback.

### Scope Note #7 — Status badge reuse: copy the shape, don't cross-import from `members/`

The "Currently Checked-In" table's Status badge column needs the same 6-state badge system `members/memberLabels.ts` already defines (`resolveBadgeStatus`/`STATUS_BADGE_CONFIG`). That file lives under the `members/` route folder, not `services/` — importing across sibling route folders (`../members/memberLabels` from `attendance/components/...`) has no precedent anywhere in this app (every existing cross-file reuse in this codebase is either same-folder or via `services/`, e.g. `getCallerGymId`/`mapAndLog` are deliberately **copied** per-file, never imported cross-service). Create a new `apps/dashboard/app/(dashboard)/attendance/attendanceLabels.ts` with the identical `STATUS_BADGE_CONFIG`/`resolveBadgeStatus` shape (same 6 states, same icons/classNames/label keys — reuse the same i18n keys under `members.status.*`, don't invent new ones) rather than importing or duplicating logic incorrectly.

## Tasks / Subtasks

- [x] **Task 1: Migration `0025` — staff read RLS policy + member occupancy function** (AC #1, #2; Scope Notes #1, #2)
  - [x] `supabase/migrations/0025_occupancy_display_admin_attendance_page.sql`: `"gym_staff_read_own_attendance_events"` SELECT policy on `attendance_events` (owner/manager/receptionist, gym-scoped via `private.gym_id()`) exactly as specified in Scope Note #1.
  - [x] Same migration: `member_occupancy_band()` SECURITY DEFINER function exactly as specified in Scope Note #2, with `revoke ... from public` / `grant execute ... to authenticated`.

- [x] **Task 2: Dashboard service layer — `apps/dashboard/services/attendance.ts`** (AC #2; Scope Notes #3, #4, #5)
  - [x] Update `checkOutMember()` to return `{ data: { checkedOutAt: string } | null, error }`, per Scope Note #5.
  - [x] Add `getCurrentlyCheckedIn()`: joins `attendance_events` (open sessions, `checked_out_at is null`, gym-scoped) to `members(name, deactivated_at)` and each member's most recent `subscriptions(status)` (mirror `listMembers`'s embed/order/limit(1) pattern, `apps/dashboard/services/members.ts:210-220`), sorted by `checked_in_at` ascending. Returns rows with member id/name, `checkedInAt`, and the resolved badge status inputs (`status`, `deactivatedAt`).
  - [x] Add `getTodayAttendanceCount()`: `count("id", {count: "exact", head: true})` on `attendance_events` where `gym_id` matches and `checked_in_at` falls within the UTC calendar day (Scope Note #4) — count every check-in today regardless of open/closed state.
  - [x] Add `listAttendanceLog(params: { page?: number; from?: string; to?: string; memberSearch?: string })`: paginated (`ATTENDANCE_LOG_PAGE_SIZE = 50`, matches AD-11's spec), joined to `members!inner(name)` when `memberSearch` is set (mirror `listMembers`'s `useInnerJoin` pattern for the same reason: filtering an embedded resource needs the inner join to actually exclude non-matching parent rows), `.gte("checked_in_at", fromStart).lt("checked_in_at", toEndExclusive)`, member-name `ilike` (reuse/copy `escapeIlike` from `members.ts`, same escaping rationale), ordered by `checked_in_at` **descending** (matches `AD-12` Audit Log's own "default: newest first" convention — this is a log, not the live roster). Default `from`/`to` to today's UTC date when the caller passes neither (Scope Note #4).

- [x] **Task 3: Mobile service layer — `apps/mobile/src/services/occupancy.ts`** (AC #1; Scope Note #2)
  - [x] New file: `getOccupancyBand()` exactly as specified in Scope Note #2. Check `apps/mobile/src/services/checkin.ts`'s existing Supabase client import and error-shape conventions first and match them. No screen calls this function in this story.

- [x] **Task 4: Error mapping + i18n for `check_out_member()`'s raises** (AC #2; Scope Note #6)
  - [x] `packages/types/src/errors.ts`: two new `mapSupabaseError` branches exactly as specified in Scope Note #6.
  - [x] `packages/types/src/locales/en.json` / `fr.json`: add `errors.noOpenCheckIn` (copy in Scope Note #6). Reuse the existing `errors.memberNotFound` key for the not-found branch — no new key for that one.

- [x] **Task 5: Dashboard Attendance page — route, components, actions** (AC #2; Scope Note #3)
  - [x] `apps/dashboard/app/(dashboard)/attendance/page.tsx`: Server Component + explicit `<Suspense>` wrapping the data-fetching component (mirrors `members/page.tsx`'s exact structure — this app's `cacheComponents: true` requires the explicit boundary). Fetches `getCurrentlyCheckedIn()`, `getTodayAttendanceCount()`, `listAttendanceLog({...searchParams})`, and `getDashboardShellContext()` in parallel via `Promise.all`. Reads `page`, `from`, `to`, `memberSearch` from `searchParams`, defaulting `from`/`to` to today's UTC date (Scope Note #4) when absent.
  - [x] `apps/dashboard/app/(dashboard)/attendance/loading.tsx`: skeleton rows (mirror `members/loading.tsx`'s shape).
  - [x] `apps/dashboard/app/(dashboard)/attendance/actions.ts`: `"use server"` — `checkOutMemberAction(memberId: string)`, a thin wrapper over `checkOutMember()` (no Zod needed — bare UUID, matches `checkOutMember`'s own established "nothing else to validate" rationale from Story 3.5).
  - [x] `apps/dashboard/app/(dashboard)/attendance/attendanceLabels.ts`: `STATUS_BADGE_CONFIG`/`resolveBadgeStatus`, exactly as specified in Scope Note #7.
  - [x] `apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx`: client component. Renders:
    - Header: "Currently Checked In (N members)" + "Today: N check-ins" + `[Refresh]` button (`router.refresh()`).
    - Currently-Checked-In table: avatar-initial + name, check-in time, status badge (via `attendanceLabels.ts`), "Check Out" button per row → opens `CheckOutMemberConfirmDialog`. Empty state: "No one is checked in right now."
    - Daily Log: two `<input type="date">` filters (from/to, both defaulting to today), a debounced member-name search input (300ms, matches `MembersPageClient`'s own established debounce pattern), table (Member, Check-in, Check-out [`"—"` if open], Duration [`"Open"` if `checkedOutAt` is null, else `"{h}h {m}m"` via a per-file `formatDuration` helper, matching `checkin.tsx`'s `formatCheckInTime`'s "per-file-local date helper" convention]), pagination controls (mirror `MembersPageClient`'s `pageWindow`/Previous-Next pattern, 50 rows/page). Empty state: "No check-ins recorded for this period."
    - Format check-in/check-out times and dates locale-aware via `i18n.language` — build the `Date` from parsed Y/M/D/H/M components where a plain `new Date(string)` would UTC-shift (mirror `MembersPageClient.expiryLabel`'s already-fixed bug for date-only values; full timestamps don't need this, only the date-range query params if ever round-tripped as date-only strings).
  - [x] `apps/dashboard/app/(dashboard)/attendance/components/CheckOutMemberConfirmDialog.tsx`: native `<dialog>`, mirrors `DeactivateMemberDialog`'s structural pattern (no reason field) — "Check out {{name}}?" / [Cancel] [Check Out] — calls `checkOutMemberAction`, surfaces `error.message` inline on failure (including the two newly-mapped messages from Task 4), calls `router.refresh()` + closes on success.

- [x] **Task 6: i18n — `apps/dashboard/locales/en.json` / `fr.json`** (AC #2)
  - [x] New top-level `attendance` namespace: `title`, `checkedInHeading` ("Currently Checked In ({{count}} members)"), `todayCount` ("Today: {{count}} check-ins"), `refresh`, `emptyCheckedIn` ("No one is checked in right now."), `dailyLogHeading` ("Daily Log"), `table.member`/`table.checkIn`/`table.checkOut`/`table.duration`/`table.status`/`table.actions`, `durationOpen` ("Open"), `emptyLog` ("No check-ins recorded for this period."), `searchPlaceholder` ("Search by member name"), `checkOutButton` ("Check Out"), `checkOutDialog.title` ("Check out {{name}}?"), `checkOutDialog.confirmButton` ("Check Out"), `checkOutDialog.checkingOut` ("Checking out…"), `dateFrom`/`dateTo` labels, pagination keys (reuse `members.pagination.*` shape/copy if `i18next` namespacing allows a shared key, otherwise duplicate the three strings under `attendance.pagination.*` — this app has no shared-namespace precedent for pagination copy, so duplicate to match `members`/`plans`' own independent-namespace convention).
  - [x] Run `node scripts/check-i18n-key-parity.mjs` after — both `apps/dashboard/locales` and `packages/types/src/locales` must stay EN/FR key-parity clean.

- [x] **Task 7: pgTAP coverage** (AC #1, #2; Scope Notes #1, #2)
  - [x] New `supabase/tests/occupancy_display_admin_attendance_page.test.sql`, following `manual_renewal_reset.test.sql`'s session-simulation convention (`set local role authenticated` + `set_config('request.jwt.claims', ...)`, `reset role` before asserting on committed state).
  - [x] RLS: owner/manager/receptionist-claim sessions can `select` from `attendance_events` for their own gym; a coach-claim session's `select` returns 0 rows (RLS-denied, not an error); a cross-tenant staff session's `select` against another gym's rows returns 0 rows.
  - [x] `member_occupancy_band()`: assert `'low'`/`'medium'`/`'busy'` at representative percentages (e.g. capacity 100 with 10/50/80 checked-in), assert `null` when `capacity` is `null`, assert a non-`member`-role session raises `%permission denied%`.
  - [x] Assert the raw checked-in count and `capacity` are never selectable by a member-claim session on `gyms`/`attendance_events` directly (RLS still deny-all/staff-only for those tables from a member session) — the band function is the *only* channel, backstopping Scope Note #2's "never raw counts" requirement at the DB layer, not just the app layer. **Finding:** true for `attendance_events` (proven by this story's pgTAP suite); NOT true for `gyms.capacity`, which a pre-existing, unrelated RLS policy (0009, Story 1.8) already exposes to any gym-scoped session regardless of role — see deferred-work.md, this is out of scope to fix here (no existing migration may be touched) but is a real gap in FR-047's literal requirement.

- [x] **Task 8: Validation** (all automated validation passed; manual browser verification accepted as a documented, non-code environment blocker — see below)
  - [x] `pnpm run typecheck` (all packages, 0 errors) and `node scripts/check-i18n-key-parity.mjs` (0 errors).
  - [x] `supabase test db` — confirm the new file passes and zero regressions in the existing suite (318/318 passing, up from the 303 baseline).
  - [ ] Manually verify `/attendance` renders for a seeded owner/manager/receptionist session and 404s/redirects appropriately are unaffected for coach/member sessions (Sidebar already hides the nav item; RLS is the real gate, per this app's established "Sidebar hides it, RLS is the real enforcement" precedent). **Still not completed, across two sessions:** re-investigated 2026-07-28 — `wsl --shutdown` did restore Windows-native reachability to WSL's Supabase for a few minutes, but it then dropped out again; root-caused this time to `docker.service` itself crash-looping inside WSL (restarting every 30–90s, cascading into the auth/DB containers), not a Windows↔WSL routing gap as first suspected. This is a genuine local-machine Docker/WSL stability issue, independent of this story's code — full diagnosis and next steps for whoever picks it up are in `deferred-work.md`. RLS/business logic was instead verified via the real pgTAP suite executed inside WSL (in the windows dockerd stayed up) against genuine local Postgres.

### Review Findings

- [x] [Review][Patch] No pagination/cap on the Currently Checked-In table — a busy gym with many simultaneous check-ins renders an unbounded table (unlike the paginated Daily Log directly below it in the same page). **Resolved (user decision, 2026-07-28): paginate it using the same 50-row pagination pattern as the Daily Log.** [apps/dashboard/services/attendance.ts:getCurrentlyCheckedIn, apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx]

- [x] [Review][Patch] Unvalidated `from`/`to` date query params can crash the page render — `dateEndExclusiveIso()` does `new Date(Date.UTC(...))` on a split date string with no format validation; a hand-edited URL or a cleared native `<input type="date">` (which emits `""`, not `undefined`, so the `params.from ?? today` default never kicks in) reaches it with a malformed value, producing `new Date(NaN).toISOString()` → `RangeError` → a 500 for that request. [apps/dashboard/services/attendance.ts, apps/dashboard/app/(dashboard)/attendance/page.tsx]
- [x] [Review][Patch] No page-bounds clamping in the Daily Log — a stale bookmark or hand-edited `?page=` beyond the last valid page returns zero rows with no clamp/redirect to the last real page, so the table silently renders empty. [apps/dashboard/services/attendance.ts:listAttendanceLog]
- [x] [Review][Patch] Debounced member-search update can race a date-range filter change within the 300ms window — the pending debounce closes over a stale `searchParams`, so firing it after a date change silently reverts that date change. [apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx]
- [x] [Review][Patch] Nondeterministic "most recent subscription" tie-break in `getCurrentlyCheckedIn()` — rows are ordered by `created_at desc` only; if two subscriptions for the same member share an identical `created_at` (bulk-created same millisecond), which one "wins" as most-recent is nondeterministic, so the status badge could flip between page loads. Add a deterministic secondary sort key (e.g. `id`). [apps/dashboard/services/attendance.ts:getCurrentlyCheckedIn]
- [x] [Review][Patch] `todayUtcDate()` is duplicated verbatim in two files instead of one shared helper — a future change to the UTC-boundary logic (e.g. adopting `gyms.timezone`, already a documented deferred gap) now has two call sites to keep in sync. [apps/dashboard/services/attendance.ts, apps/dashboard/app/(dashboard)/attendance/page.tsx]
- [x] [Review][Patch] `formatDuration()`'s `"{h}h {m}m"` output is hardcoded English, never routed through i18n, on an otherwise fully-translated page — a direct miss against this story's own Dev Notes constraint ("every new UI text goes through i18n, FR-016, CI-enforced"); `check-i18n-key-parity.mjs` only checks key parity between locale files, so it doesn't catch a hardcoded string that was never turned into a key at all. [apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx:formatDuration]
- [x] [Review][Patch] Blank member name has no fallback — `getCurrentlyCheckedIn()`/`listAttendanceLog()` fall back to `""` when the joined `members` row is null, rendering an empty name cell instead of something diagnosable (e.g. a placeholder or the member ID). [apps/dashboard/services/attendance.ts]
- [x] [Review][Patch] `handleRefresh()`'s "refreshing" spinner is a fixed 500ms `setTimeout`, unrelated to whether `router.refresh()` actually completed — can re-enable the button before the refresh lands, or leave it disabled longer than needed. [apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx:handleRefresh]

- [x] [Review][Defer] `escapeIlike()` doesn't escape PostgREST composite-filter metacharacters (comma/parens) — deferred, pre-existing: copied verbatim from `members.ts`'s own `escapeIlike`, so if this is exploitable it predates this story and isn't introduced here. [apps/dashboard/services/attendance.ts]
- [x] [Review][Defer] Each new read function independently resolves `getCallerGymId()`/`getClaims()` rather than once per page load — deferred, pre-existing: matches every other service file's established per-function convention in this codebase, and `getClaims()` is a local JWT decode, not a network round trip. [apps/dashboard/services/attendance.ts]
- [x] [Review][Defer] A single failed sub-request blanks the whole `/attendance` page (all-or-nothing `Promise.all` error check, discarding data from calls that succeeded) — deferred, pre-existing: verified this exactly mirrors `members/page.tsx`'s own established pattern (`membersError || shellError || !shell || plansError`), not a new issue. [apps/dashboard/app/(dashboard)/attendance/page.tsx]
- [x] [Review][Defer] Error-mapping via raw message substring matching is brittle against future SQL wording changes — deferred, pre-existing: this is `errors.ts`'s established, spec-mandated pattern (Scope Note #6 explicitly directs following `renew_subscription()`'s exact substring-match style). [packages/types/src/errors.ts]
- [x] [Review][Defer] Deactivated-but-still-checked-in members are only cosmetically badge-flagged, with no forced-checkout action — deferred, out of scope: a real product question, but not mentioned anywhere in this story's AC or Scope Notes. [apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx]
- [x] [Review][Defer] `formatDuration()` silently clamps a negative duration to `"0h 0m"` instead of surfacing the anomaly — deferred: low real-world likelihood (requires clock skew or direct DB manipulation), and the right handling (log? distinct display?) isn't specified anywhere. [apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx:formatDuration]
- [x] [Review][Defer] Generic empty-state copy doesn't distinguish "no data for this range" from "no search matches" — deferred, polish: not specified by the story, low priority. [apps/dashboard/locales/en.json, apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx]

## Dev Notes

- **Four independent surfaces, don't conflate them:** (1) a new RLS policy + `member_occupancy_band()` on the backend, (2) the dashboard's `/attendance` route (the bulk of this story), (3) one unused-until-3.7 mobile service function, (4) two small error-mapping/i18n additions carried over from Story 3.5's deliberate deferrals.
- **The Front-Desk Alert Panel is not this story's job.** If `dev-story` or `code-review` finds itself building `FrontDeskAlertPanel.tsx` or a `gym:<gym_id>:alerts` Realtime subscription, stop — that's Epic 4 Story 4.6, per architecture.md's own FR-to-file mapping table.
- **AD-02 (Overview) is not this story's job either.** It's still Story 1.8's placeholder page and stays that way after this story.
- **No real per-gym timezone date math in this story** — UTC calendar day only, matching the accepted, documented gap from Story 3.1/3.2 (`deferred-work.md`).
- **The raw occupancy count/capacity must never be returned to a member-role client** — `member_occupancy_band()` returns only the band label; this is a security requirement (FR-047), not a style preference, and Task 7's pgTAP suite must prove it at the DB layer.
- `check_out_member()`'s underlying RPC already logs its own audit entry (`attendance_manual_checkout`, added in Story 3.5's Review Findings) — `checkOutMemberAction` needs no separate `logAttendanceChange`/audit call of its own, unlike `deactivateMember`'s two-step pattern in `members/actions.ts`.
- Every new UI text goes through i18n (`FR-016`, CI-enforced) — no hardcoded strings in any new `.tsx` file.

### Project Structure Notes

New files:
```
supabase/migrations/0025_occupancy_display_admin_attendance_page.sql
supabase/tests/occupancy_display_admin_attendance_page.test.sql
apps/mobile/src/services/occupancy.ts
apps/dashboard/app/(dashboard)/attendance/page.tsx
apps/dashboard/app/(dashboard)/attendance/loading.tsx
apps/dashboard/app/(dashboard)/attendance/actions.ts
apps/dashboard/app/(dashboard)/attendance/attendanceLabels.ts
apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx
apps/dashboard/app/(dashboard)/attendance/components/CheckOutMemberConfirmDialog.tsx
```

Modified files:
```
apps/dashboard/services/attendance.ts        # checkOutMember() return shape + 3 new read functions
packages/types/src/errors.ts                 # 2 new mapSupabaseError branches
packages/types/src/locales/en.json            # + errors.noOpenCheckIn
packages/types/src/locales/fr.json            # same key, FR copy
apps/dashboard/locales/en.json                # + attendance.* namespace
apps/dashboard/locales/fr.json                # same keys, FR copy
```

No changes to `apps/dashboard/app/(dashboard)/page.tsx` (AD-02), `apps/mobile/src/app/**` (no mobile screen ships in this story), `apps/super-admin`, or any existing migration file.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.6] — literal AC wording (both Given/When/Then blocks)
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#FR-046 through FR-048] — occupancy calculation, three-band thresholds, admin-vs-member visibility split
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-11 · Attendance, line 1211-1245] — dashboard page layout, components, empty states
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-02 · Overview, line 879-919] — the separate, out-of-scope Overview page (stat cards, mini tables) not to be confused with AD-11
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-09 · Home, line 547-609] — confirms no occupancy band component exists in any mobile mockup today
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Role visibility matrix, line 187-193] — Attendance visible to Receptionist/Manager/Owner, not Coach — the RLS role array and mobile service role-check both follow this
- [Source: _bmad-output/planning-artifacts/architecture.md#Background jobs / Source tree, lines 328-344, 462-463] — `attendance/page.tsx` + `actions.ts` file placement; Front-Desk Alert Panel scoped to FR-049-052 (Epic 4 Story 4.6), not this story
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `checkOutMember()`'s discarded return value (explicitly flagged for this story); the `gyms.timezone`-unused-in-date-math precedent
- [Source: supabase/migrations/0018_member_management.sql#gym_staff_read_own_members, lines 167-172] — the staff-read RLS policy shape this story's new `attendance_events` policy follows exactly
- [Source: supabase/migrations/0024_check_out_manual_auto_timeout.sql] — `check_out_member()`'s existing shape/audit-logging (already returns `attendance_events`, already logs `attendance_manual_checkout`) — nothing here needs to change
- [Source: supabase/migrations/0022_manual_renewal_reset.sql, lines 60-64] — the UTC-calendar-day / `gyms.timezone`-unused precedent this story's date math follows
- [Source: packages/types/src/errors.ts#renew_subscription mappings, lines 140-160] — the exact message-substring mapping pattern this story's two new branches follow
- [Source: apps/dashboard/services/members.ts#listMembers, lines 190-238] — the embed/join/pagination/inner-join-for-embedded-filter pattern `getCurrentlyCheckedIn`/`listAttendanceLog` follow
- [Source: apps/dashboard/app/(dashboard)/members/memberLabels.ts] — the badge-status shape `attendanceLabels.ts` duplicates (not cross-imports, per Scope Note #7)
- [Source: apps/dashboard/app/(dashboard)/members/components/DeactivateMemberDialog.tsx] — the confirmation-dialog structure `CheckOutMemberConfirmDialog` follows (minus the reason field)
- [Source: apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx] — debounced search, pagination window, `router.refresh()`-after-mutation, and the locale-safe date-parsing pattern (`expiryLabel`) this story's Daily Log follows
- [Source: apps/dashboard/app/(dashboard)/members/page.tsx] — the Server Component + explicit `<Suspense>` + parallel `Promise.all` fetch pattern `attendance/page.tsx` follows
- [Source: apps/dashboard/components/shared/Sidebar.tsx, line 41] — the already-scaffolded `/attendance` nav entry (role array `["receptionist","manager","owner"]`) this story's RLS policy matches
- [Source: apps/mobile/src/app/(tabs)/checkin.tsx] — this app's existing Supabase-client/error-handling convention `occupancy.ts` should match
- [Source: supabase/tests/manual_renewal_reset.test.sql] — the session-simulation pgTAP convention this story's new test file follows

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- 2026-07-28 environment investigation: `journalctl -u docker` inside WSL showed `docker.service` crash-looping (~30–90s cycle); `systemctl status docker`; `docker logs supabase_auth_gym_os` (GoTrue fatal on `the database system is starting up` / `connection refused`); `free -h` and `dmesg | grep -i oom` (ruled out OOM); passive `curl.exe`-only 2-minute poll confirmed the instability is independent of this session's own WSL client invocations. Full findings in `deferred-work.md`.

### Completion Notes List

- Tasks 1–7 implemented and verified per their subtask checklists (migration 0025, dashboard service layer, mobile occupancy service, error mapping/i18n, dashboard Attendance page, i18n namespace, pgTAP coverage). `pnpm typecheck`, `check-i18n-key-parity.mjs`, and `supabase test db` (318/318) all pass.
- Task 8's manual browser verification remains incomplete across two sessions. The 2026-07-25 session attributed this to a Windows↔WSL localhost-forwarding gap; a 2026-07-28 follow-up session re-investigated and found the real cause is `dockerd` itself crash-looping inside WSL on this machine — a deeper, pre-existing local-environment stability issue, not a code defect and not fixable within a dev session (see `deferred-work.md` for the full diagnosis and suggested next steps: check Windows Update/Hyper-V/AV interference, WSL2 vhdx disk health, or reinstalling Docker Engine inside the distro).
- Given automated coverage (pgTAP, typecheck, i18n-parity) is complete and passing, and the remaining gap is an environment issue outside this story's code, the story is moved to `review` with Task 8's manual-browser sub-item left open and documented rather than blocking indefinitely on an unrelated infrastructure problem.

### File List

**New:**
- `supabase/migrations/0025_occupancy_display_admin_attendance_page.sql`
- `supabase/tests/occupancy_display_admin_attendance_page.test.sql`
- `apps/mobile/src/services/occupancy.ts`
- `apps/dashboard/app/(dashboard)/attendance/page.tsx`
- `apps/dashboard/app/(dashboard)/attendance/loading.tsx`
- `apps/dashboard/app/(dashboard)/attendance/actions.ts`
- `apps/dashboard/app/(dashboard)/attendance/attendanceLabels.ts`
- `apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx`
- `apps/dashboard/app/(dashboard)/attendance/components/CheckOutMemberConfirmDialog.tsx`

**Modified:**
- `apps/dashboard/services/attendance.ts`
- `packages/types/src/errors.ts`
- `packages/types/src/locales/en.json`
- `packages/types/src/locales/fr.json`
- `apps/dashboard/locales/en.json`
- `apps/dashboard/locales/fr.json`
- `_bmad-output/implementation-artifacts/deferred-work.md`

## Change Log

- 2026-07-25: Tasks 1–7 implemented; Task 8 automated validation passed (typecheck, i18n-parity, pgTAP 318/318); manual browser verification blocked, initially attributed to a Windows↔WSL network gap.
- 2026-07-28: Re-investigated the Task 8 blocker. `wsl --shutdown` restored connectivity only briefly; root-caused to `docker.service` crash-looping inside WSL (unrelated to Windows/Node/network routing). Updated `deferred-work.md` with the corrected diagnosis. Story moved to `review` — Task 8's live-browser check remains the one open item, documented as a local-environment gap rather than a code defect.
- 2026-07-29: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). No AC/spec violations. 1 decision-needed (Currently Checked-In table pagination — resolved: paginate it like the Daily Log) + 8 patch findings, all applied: date-param validation to prevent a render crash, Daily Log + Currently Checked-In page-bounds clamping, a debounced-search/date-filter race fix, a deterministic subscription tie-break, `todayUtcDate()` de-duplication, i18n for `formatDuration()`, a blank-member-name fallback, and a `useTransition`-based refresh state. 7 findings deferred as pre-existing/out-of-scope (see `deferred-work.md`). `pnpm run typecheck` (0 errors), `check-i18n-key-parity.mjs` (0 errors), and eslint on touched files all re-verified clean after patches. Story marked `done`.
