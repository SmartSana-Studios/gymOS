---
baseline_commit: 9dc27bd8626132244febc7b2998529c662cdb5fc
---

# Story 4.6: Real-Time Front-Desk Alert

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Receptionist, Manager, or Owner,
I want an instant alert when an at-risk member checks in,
so that I can catch them before they leave without renewing.

## Scope Notes — Read Before the Acceptance Criteria

**This is the first story in the codebase to use Supabase Realtime and TanStack Query.** No `supabase_realtime` publication exists yet, `@tanstack/react-query` is not in `apps/dashboard/package.json`, and no `QueryClientProvider` exists. Architecture (`architecture.md` line 141, 176) explicitly names this exact combination — "TanStack Query + Supabase Realtime for the front-desk alert panel... merging Supabase Realtime events into query cache" — as the intended pattern. Do not substitute a simpler polling-only or plain-`useState` approach; follow architecture's decision. The **polling degrade path** (line 73, 142, 199) is not optional — architecture calls out that a retention-critical alert failing silently is worse than no alert.

**`check_in()` has a real transaction-rollback problem this story must solve, not just extend.** Read `supabase/migrations/0028_member_app_offline_check_in_queueing.sql` in full first — it is the current, complete body of `check_in(p_scanned_at, p_client_scan_id)`. Today, when a member's subscription is `expired` (or has no subscription row), the function does `raise exception 'check_in: member % subscription is expired', v_member_id;` **before inserting anything**. Per FR-031, an expired check-in must still fire a **red** dashboard alert — but a `raise exception` with no enclosing `exception when ... end` block that propagates out of a `SECURITY DEFINER` function unwinds the **entire transaction** for that RPC call, including any row this story's migration tries to insert earlier in the same function call. There is no `dblink`/autonomous-transaction extension enabled in this project, and adding one is out of scope. **Resolved design:** `check_in()` no longer raises for the expired/no-subscription case. It inserts the alert row, then `return null;` (a clean, non-error return — legal for a non-`setof` composite-returning function). The RPC call succeeds with `data: null, error: null`. This is a **breaking change to an established client contract** — see Task 6 for the exact mobile-side fix, and Task 8 for the exact existing pgTAP assertions this invalidates. Do not touch the `deactivated_at` guard or the "no member record"/"permission denied" guards — those stay hard `raise exception`s, unchanged (alerts are FR-031/FR-049 scoped to subscription status only).

**Alert-insert ordering matters and is easy to get backwards.** For the accepted (`expiring_soon`/`grace_period`) case, insert the `front_desk_alerts` row **only after** the existing open-session lock/stale-check logic has committed to a real `attendance_events` insert — not earlier. If you insert it before that point, a member who is both at-risk **and** already has a non-stale open check-in (rejected via `raise exception 'check_in: member % already has an open check-in'`) would have its alert insert silently rolled back by that later, unrelated exception. That accidental behavior happens to look "correct" (no alert fires) but for the wrong reason, and breaks the moment anyone reorders the function again. Insert the alert immediately after `insert into attendance_events (...) returning * into v_row;` succeeds, unconditionally on `v_status in ('expiring_soon', 'grace_period')`.

**No audit log entry for alert creation or dismissal.** FR-080's audit-record list (manual payments, verifications, refunds, deactivations, coach reassignment, Super Admin escalation, cron failures) does not include front-desk alerts. Do not call `log_audit_event` anywhere in this story.

**`front_desk_alerts` is a new table, not a repurposing of `attendance_events`.** `attendance_events` has no row at all for a rejected (expired) check-in today, and never should — a denied entry did not happen, matching the existing "entry denied" semantics `check_in_one_open_session_enforcement.test.sql` already asserts (`no attendance_events row was inserted for the expired member`). Alerts also need `dismissed_at`/`dismissed_by`, which don't belong on a pure attendance ledger. This mirrors the established "own table, don't overload an existing one" precedent from Stories 4.4 (`payment_discrepancies`) and 4.5 (`refunds`).

**Scope boundary: only the alert panel itself.** `apps/dashboard/app/(dashboard)/page.tsx` (Overview/AD-02) is currently a deliberate stub — its own comment says stat cards, tables, and the alert panel are all deferred. This story builds **only** the `FrontDeskAlertPanel` and renders it on Overview and Attendance. It does **not** build Overview's stat cards, "Currently Checked-In" table, or "Expiring This Week" table — those belong to a future story (nothing in the FR Coverage Map assigns them to 4.6). It does **not** build the `[Renew]` button's target (`InlineRenewalPanel` is Story 4.7) — render the button as a disabled/inert placeholder... **no** — do not render a `[Renew]` button at all if it has nowhere to go; render only `[✕]` dismiss for now, matching this codebase's "don't build UI beyond what's asked" discipline (Stories 4.4/4.5's own precedent). Document this explicitly in `docs/decisions.md` since it's a visible deviation from the UX mockup.

**No member photo has ever been rendered anywhere in this dashboard.** `members.photo_url` exists and is editable (`MemberModal.tsx`) but nothing renders it as an `<img>` — every existing avatar (Attendance's checked-in table) is initials-only. This story is the first to render an actual photo, with initials fallback (UX spec: "avatar (falls back to initials if no photo)"). Don't assume an existing `<Avatar>` component — none exists; build a small inline one, consistent with how `AttendancePageClient.tsx` already renders its initials circle (`memberDisplayName(row.name).slice(0,1).toUpperCase()` inside a `size-7 rounded-full bg-muted` div).

**Realtime `postgres_changes` payloads never include joined data.** An `INSERT`/`UPDATE` event on `front_desk_alerts` only carries that table's own columns (`member_id`, `status`, `expiry_date`, ...) — never the member's `name`/`photo_url`. On receiving a realtime event for a member not already known to the panel, you must do a small follow-up read (`members` table, RLS-scoped) to resolve display fields. Don't try to avoid this by subscribing to `members` too — that's unnecessary complexity for a low-frequency event.

## Acceptance Criteria

1. **Given** a member with status `expiring_soon` or `grace_period` checks in (accepted), **when** the check-in event lands, **then** a yellow alert publishes in real time (<3s) to all active dashboard sessions for that gym via Supabase Realtime, on both Overview and Attendance. [Source: epics.md#Story 4.6 AC#1; FR-049, FR-052]
2. **Given** a member with status `expired` checks in (rejected), **when** the check-in event lands, **then** a red alert publishes in real time to the same surfaces. [Source: epics.md#Story 4.6 AC#2; FR-049, FR-031]
3. **Given** multiple alerts arrive simultaneously, **when** more than 5 exist, **then** they stack newest-on-top (max 5 visible, older scrollable within the panel). [Source: epics.md#Story 4.6 AC#3; FR-051]
4. **Given** an alert is dismissed (manually or after the gym-configured auto-dismiss duration, default 30 min), **when** the same member scans again without having renewed, **then** a new alert fires. [Source: epics.md#Story 4.6 AC#4; FR-051]
5. **Given** an offline check-in (Story 3.9) that syncs after connectivity resumes, **when** the resulting check-in event lands at sync time, **then** the alert fires based on the sync-time timestamp, not the original scan time — status is evaluated as of when the event reaches the server. [Source: epics.md#Story 4.6 AC#5]

## Tasks / Subtasks

- [x] **Task 1: Migration `0034_real_time_front_desk_alert.sql` — `front_desk_alerts` table, RLS, Realtime publication** (AC: #1, #2, #3, #4)
  - [x] Exact schema:
    ```sql
    create table front_desk_alerts (
      id uuid primary key default gen_random_uuid(),
      gym_id uuid not null references gyms(id),
      member_id uuid not null references members(id),
      status subscription_status not null,
      expiry_date date,
      created_at timestamptz not null default now(),
      dismissed_at timestamptz,
      dismissed_by uuid references users(id),
      constraint front_desk_alerts_status_check check (status in ('expiring_soon', 'grace_period', 'expired'))
    );

    create index idx_front_desk_alerts_gym_id on front_desk_alerts(gym_id);
    create index idx_front_desk_alerts_active on front_desk_alerts(gym_id) where dismissed_at is null;

    alter table front_desk_alerts enable row level security;

    grant select, update on front_desk_alerts to authenticated, service_role;
    -- No insert grant to `authenticated` -- only check_in() (SECURITY DEFINER,
    -- Task 2) inserts, same precedent as attendance_events itself.

    create policy "gym_staff_read_own_front_desk_alerts" on front_desk_alerts
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
      );

    create policy "gym_staff_dismiss_own_front_desk_alerts" on front_desk_alerts
      for update
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
      )
      with check (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
      );
    -- RLS is row-level, not column-level (same caveat 0014's
    -- owner_update_own_gym comment already documents) -- this policy doesn't
    -- stop a caller from writing to columns beyond dismissed_at/dismissed_by;
    -- no AC asks for a column-protection trigger, so none is added.

    alter publication supabase_realtime add table front_desk_alerts;
    ```
  - [x] `status` reuses the existing `subscription_status` enum (0001) rather than a new type — the CHECK constraint narrows it to the 3 values that can ever appear here (never `'active'`).
  - [x] `expiry_date` is nullable (mirrors `subscriptions.expiry_date`'s own nullability for `pay_per_session`, 0018) even though in practice only date-bound plans reach `expiring_soon`/`grace_period`/`expired` (0021's cron job only transitions rows with `expiry_date is not null`) — handle a null value gracefully in the UI (Task 7), don't assume non-null.
  - [x] `dismissed_by` is nullable: auto-dismiss (Task 7) writes `dismissed_at` only, leaving `dismissed_by` null — there is no "system" user row to attribute it to. Manual dismiss writes both.

- [x] **Task 2: Amend `check_in()` in the same migration** (AC: #1, #2, #5)
  - [x] `create or replace function public.check_in(p_scanned_at timestamptz default null, p_client_scan_id uuid default null) returns attendance_events` — same signature as 0028, so `create or replace` (not drop+create) is correct here.
  - [x] Redeclare the full body from `0028_member_app_offline_check_in_queueing.sql`, with exactly these changes:
    1. Add `v_expiry_date date;` to the `declare` block.
    2. Change `select status into v_status from subscriptions ...` to `select status, expiry_date into v_status, v_expiry_date from subscriptions ...` (same `where`/`order by`/`limit`).
    3. Replace the existing `if v_status is null or v_status = 'expired' then raise exception ...; end if;` block with:
       ```sql
       if v_status is null or v_status = 'expired' then
         insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
         values (v_gym_id, v_member_id, 'expired', v_expiry_date);
         return null;
       end if;
       ```
       (A `null` value for `v_status` — the "zero subscription rows" defensive case, same as 0027's own comment — maps to alert `status = 'expired'`, matching the existing "treated identically to expired" precedent.)
    4. Immediately after `insert into attendance_events (gym_id, member_id, checked_in_at, client_scan_id) values (...) returning * into v_row;` succeeds (i.e. right after that statement, before the `p_scanned_at`-stale-close block), add:
       ```sql
       if v_status in ('expiring_soon', 'grace_period') then
         insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
         values (v_gym_id, v_member_id, v_status, v_expiry_date);
       end if;
       ```
    5. Everything else (permission checks, member resolution, `client_scan_id` idempotent-replay short-circuit, `deactivated_at` guard, open-session lock/stale-close, offline-sync immediate-close block, final `return v_row;`) is unchanged from 0028 — copy verbatim.
  - [x] Re-issue `revoke execute ... from public; grant execute ... to authenticated;` for the same `(timestamptz, uuid)` signature at the end (matches 0028's own re-grant, needed again since this is a fresh `create or replace` in a new migration file — actually not needed since the signature is unchanged and grants persist across `create or replace`; skip the re-grant, but verify via `\df+ check_in` after `supabase db reset` that `authenticated` still has `EXECUTE`).

- [x] **Task 3: Regenerate `packages/types/src/database.ts`** (AC: all)
  - [x] `supabase gen types typescript --local` after Task 1/2's migration applies cleanly. Review the diff line-by-line — expect only the new `front_desk_alerts` Row/Insert/Update/Relationships block, no unrelated churn.

- [x] **Task 4: Zod schema — `dismissFrontDeskAlertSchema`** (AC: #4)
  - [x] New file `packages/types/src/schemas/frontDeskAlert.ts`:
    ```ts
    import { z } from "zod";

    export const dismissFrontDeskAlertSchema = z.object({
      alertId: z.uuid(),
    });

    export type DismissFrontDeskAlertInput = z.infer<typeof dismissFrontDeskAlertSchema>;
    ```

- [x] **Task 5: `apps/dashboard/services/session.ts` — expose `gymId`** (AC: #1, #2)
  - [x] Add `gymId: string;` to the `DashboardShellContext` interface and to the returned object in `getDashboardShellContext()` (the value is already resolved locally as `gymId` in that function — one-line addition, no new query).

- [x] **Task 6: `apps/dashboard/services/frontDeskAlerts.ts` — server-side initial read** (AC: #1, #2, #3)
  - [x] New file, modeled on `services/attendance.ts`'s structure (`createClient` from `@/lib/supabase/server`, `getCallerGymId` copied per this app's established per-file-copy discipline).
  - [x] `listActiveFrontDeskAlerts(): Promise<{ data: { alerts: FrontDeskAlertRow[]; autoDismissMinutes: number } | null; error: AppError | null }>` — runs two queries via `Promise.all`:
    - `.from("front_desk_alerts").select("id, member_id, status, expiry_date, created_at, members(name, photo_url)").eq("gym_id", gymId).is("dismissed_at", null).order("created_at", { ascending: false })`
    - `.from("gyms").select("alert_auto_dismiss_minutes").eq("id", gymId).single()`
    - Row shape: `{ id, memberId, memberName, memberPhotoUrl, status, expiryDate, createdAt }` (flatten the `members` embed; `members` is a to-one embed here since `member_id` isn't unique on this table but the embed is via the FK, so it comes back as a single object, not an array — verify against the generated types from Task 3, matching the `refunds`-embed lesson documented in Story 4.5's Review Findings).
  - [x] This function is called from Overview/Attendance `page.tsx` (Server Components) for the initial SSR render only — the client-side realtime path (Task 8) does its own subsequent reads via the browser client, never via this file (this file uses the server/cookie-based client and cannot run in the browser).

- [x] **Task 7: `apps/mobile/src/services/checkin.ts` — adapt to the new `check_in()` contract** (AC: #2, #5)
  - [x] `recordCheckIn()`: `check_in()` no longer throws for the expired case (Task 2) — it returns `{ data: null, error: null }`. Change the function to: after the existing `if (error) {...}` branch (still needed for `already_checked_in`/genuine errors), add `if (!data) return { status: 'expired' };` before the final `return { status: 'success', checkedInAt: data.checked_in_at };`.
  - [x] `syncPendingCheckIns()`: re-verify, don't blindly trust, that `if (!error || !error.message?.includes('already has an open check-in')) await deleteOfflineCheckIn(...)` still deletes correctly for the expired case now that it's `!error` (true) with `data: null` rather than a thrown error — it does (the condition only branches on `error`), but confirm no code path anywhere else in this file inspects `data` after this call in a way that would break on `null`.
  - [x] No change to `apps/mobile/src/app/(tabs)/checkin.tsx` or any mobile locale file — the `'expired'` status string and its downstream UI (expired-denied screen state, Story 3.8) are unchanged; only how that status is *detected* changes.

- [x] **Task 8: TanStack Query + Realtime plumbing** (AC: #1, #2, #3)
  - [x] Add `"@tanstack/react-query": "latest"` to `apps/dashboard/package.json` (matches this app's existing `"latest"` convention for `@supabase/*`), then install.
  - [x] New `apps/dashboard/lib/query-provider.tsx` (client component, mirrors `lib/i18n/client-provider.tsx`'s shape): creates one `QueryClient` via `useState(() => new QueryClient())` and wraps `children` in `<QueryClientProvider>`. Wire it into `app/layout.tsx`'s `LocaleShell`, inside `I18nClientProvider`/`ThemeProvider`, wrapping `children` — every dashboard page gets a query client, not just Overview/Attendance (matches the "one client at the root" idiom, avoids a second provider only under `(dashboard)`).
  - [x] New `apps/dashboard/lib/realtime/frontDeskAlerts.ts` — **client-only** module (uses `@/lib/supabase/client`'s browser `createClient`, never the server one; this is the same "browser SDK usage directly from client code" precedent `Sidebar.tsx`/`login-form.tsx` already establish for `supabase.auth.*`, applied here to `supabase.channel`/`supabase.from` for the same reason: Realtime and this dismiss write are inherently browser-native operations, not business-logic Server Actions):
    - `subscribeToFrontDeskAlerts(gymId, onInsertOrUpdate: (row) => void, onStatusChange: (status) => void)`: opens `supabase.channel(\`gym:${gymId}:alerts\`)`, `.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'front_desk_alerts', filter: \`gym_id=eq.${gymId}\` }, ...)`, and a second `.on('postgres_changes', { event: 'UPDATE', ... })` for dismissals (so a dismiss by one session removes the alert from every other open session too), `.subscribe((status) => onStatusChange(status))`. Returns the channel (caller owns cleanup via `supabase.removeChannel`).
    - `resolveMemberDisplay(memberId)`: `.from("members").select("name, photo_url").eq("id", memberId).single()` — the follow-up read for realtime payloads (Scope Notes).
    - `dismissFrontDeskAlert(alertId)`: validates via `dismissFrontDeskAlertSchema`, resolves the caller's own user id via `supabase.auth.getClaims()` (`claims.sub`), then `.from("front_desk_alerts").update({ dismissed_at: new Date().toISOString(), dismissed_by: claims.sub }).eq("id", alertId).is("dismissed_at", null)` — the `.is("dismissed_at", null)` guard makes a duplicate/racing dismiss (manual click racing an auto-dismiss timer, or two sessions clicking simultaneously) a harmless no-op (0 rows affected), not an error. RLS (Task 1) is the real authorization gate; this is a direct client write, not a Server Action, matching the same "browser-native, RLS-gated" reasoning as the subscription itself. Returns `{ error: AppError | null }` using the same `mapSupabaseError` shape as everywhere else, imported from `@gymos/types`.
  - [x] Polling degrade path: on any `onStatusChange` value other than `'SUBSCRIBED'` (i.e. `'TIMED_OUT'`, `'CHANNEL_ERROR'`, `'CLOSED'`) after having previously reached `'SUBSCRIBED'` once, start polling (`queryClient.invalidateQueries` or a direct refetch of the active-alerts list) every 5s until `'SUBSCRIBED'` is observed again; stop the interval on resubscribe. This satisfies architecture's explicit "must implement a polling degrade path... instead of silently receiving no alerts" requirement (architecture.md lines 73, 142, 199).

- [x] **Task 9: `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx`** (AC: #1, #2, #3, #4)
  - [x] Client component. Props: `{ gymId: string; initialAlerts: FrontDeskAlertRow[]; autoDismissMinutes: number }`.
  - [x] Uses `useQuery({ queryKey: ['frontDeskAlerts', gymId], initialData: initialAlerts, queryFn: () => refetch-via-a-thin-client-side-read })` (TanStack Query array-key convention per architecture.md line 240) as the source of truth for the rendered list; `subscribeToFrontDeskAlerts` (Task 8) merges realtime INSERT/UPDATE events into that cache via `queryClient.setQueryData` — new INSERT prepends (after resolving member display via `resolveMemberDisplay`), UPDATE with a non-null `dismissed_at` removes the row from the cached list. Clean up the channel subscription (`supabase.removeChannel`) on unmount.
  - [x] Rendering: nothing when the active list is empty (UX: "Panel invisible when alert count = 0 — no empty state"); otherwise render up to 5 rows (newest first — the query already orders `created_at desc` and new realtime inserts are prepended), with `max-h-[320px] overflow-y-auto` for a 6th+ row, matching the UX mockup's fixed max-height/internal-scroll spec.
  - [x] Per-row: initials-fallback avatar (40px, first-letter-of-name circle matching `AttendancePageClient`'s existing initials pattern — but 40px per the UX spec's avatar size, not that file's 28px), member name, status label (reuse the existing `members.status.expiringSoon`/`gracePeriod`/`expired` i18n keys — UX-DR5 mandates this exact color+label+icon consistency, don't invent new copy), a days-until/since-expiry line computed from `expiryDate` vs. today (omit this line entirely when `expiryDate` is null), and a `[✕]` dismiss button (no `[Renew]` button — Scope Notes).
  - [x] Color/ARIA: yellow row styling + `aria-live="polite"` for `expiring_soon`/`grace_period`; red row styling + `aria-live="assertive"` for `expired` (UX spec, exact requirement).
  - [x] Panel container renders "pushed" into normal document flow (no `position: fixed`/z-index overlay) — a plain block above the page's `<h1>`, matching "pushes page content down, not an overlay."

- [x] **Task 10: Wire the panel into Overview and Attendance** (AC: #1, #2, #3)
  - [x] `apps/dashboard/app/(dashboard)/page.tsx`: currently a synchronous stub with zero data fetching. Make it call `getDashboardShellContext()` and `listActiveFrontDeskAlerts()` (Task 5/6, in parallel via `Promise.all`, following `attendance/page.tsx`'s existing `<Suspense>`-wrapped-async-child structure for the cookie-based Supabase read), then render `<FrontDeskAlertPanel gymId={shell.gymId} initialAlerts={...} autoDismissMinutes={...} />` above the existing `<h1>`/body. On a load error, fall back to the existing stub content (don't let a failed alert fetch break the whole Overview page — same "own error handling per surface" discipline as `attendance/page.tsx`).
  - [x] `apps/dashboard/app/(dashboard)/attendance/page.tsx`: already calls `getDashboardShellContext()` but discards the result today (only checks `shellError`). Add `listActiveFrontDeskAlerts()` to the existing `Promise.all`, and pass `shell.gymId`/the alerts/`autoDismissMinutes` through to `AttendancePageClient` as new props.
  - [x] `AttendancePageClient.tsx`: accept the new props, render `<FrontDeskAlertPanel .../>` at the very top of the returned JSX (above the current `<div className="space-y-8">`'s first child), matching "identical to AD-02" (EXPERIENCE.md line 1238).

- [x] **Task 11: i18n** (AC: #1, #2, #3, #4)
  - [x] `apps/dashboard/locales/en.json`/`fr.json`: new top-level `"frontDeskAlert"` block — `expiresIn` (`"Expires in {{count}} day"`/`"_other"` variant not required, matches this project's existing documented non-pluralized convention, see `deferred-work.md`'s `alertAutoDismissUnit` precedent — a single non-pluralized string is consistent, not a new gap), `expiredDaysAgo`, `deniedMessage` ("Collect payment to restore access" — UX copy, red alerts only), `dismiss` (aria-label for `[✕]`), `unknownMember` (fallback if a member row is somehow missing — mirror `attendance.unknownMember`'s existing precedent). Reuse `members.status.expiringSoon`/`gracePeriod`/`expired` verbatim for the status label — do not duplicate those strings.
  - [x] Verify via `node scripts/check-i18n-key-parity.mjs`.

- [x] **Task 12: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) the `check_in()` throw→return-null contract change for the expired case and why (transaction-rollback constraint, no autonomous-transaction extension available); (2) `front_desk_alerts` as a new dedicated table, not an `attendance_events` extension; (3) this story is the first use of Supabase Realtime (`supabase_realtime` publication) and TanStack Query in the codebase; (4) the deliberate scope cut of no `[Renew]` button on the alert (Story 4.7 territory) and no Overview stat cards/tables (unassigned to any current story).

- [x] **Task 13: pgTAP coverage** (AC: all)
  - [x] **Update `supabase/tests/check_in_one_open_session_enforcement.test.sql` first — this is a required fix, not new coverage.** The three `throws_like(check_in(), '%subscription is expired%', ...)` assertions at (per current line numbers) 258, 332, and 502 will fail after Task 2's change, since `check_in()` no longer throws for that case. Rewrite each to assert a null return instead, e.g. `select is((select check_in())::text, null, 'a member with an expired subscription gets a null return on check-in (no exception)');` (or the pgTAP `results_eq`/`is` form appropriate to a composite-type null — verify the exact assertion syntax against a real run). The adjacent `select is((select count(*)::int from attendance_events where ...), 0, 'no attendance_events row was inserted for the expired member')` assertions are unaffected by this change and stay as-is.
  - [x] New file `supabase/tests/real_time_front_desk_alert.test.sql`, seeding a gym/tier/member/plan/subscription fixture set (mirror `check_in_one_open_session_enforcement.test.sql`'s or `refund_recording.test.sql`'s seeding style):
    - A `grace_period`-status member's `check_in()` call produces exactly one `front_desk_alerts` row with `status = 'grace_period'`, `dismissed_at is null`.
    - An `expired`-status member's `check_in()` call returns null, produces exactly one `front_desk_alerts` row with `status = 'expired'`, and zero `attendance_events` rows (cross-check against Task 2's rewritten assertions above, not a duplicate of them).
    - An `active`-status member's `check_in()` call produces zero `front_desk_alerts` rows.
    - A `grace_period` member who already has a non-stale open check-in: `check_in()` raises `'already has an open check-in'` (unchanged existing behavior) AND produces zero `front_desk_alerts` rows (proves the Task 2 ordering fix — the alert insert must not have fired before the later exception rolled it back, i.e. it never fired at all).
    - RLS: owner/manager/receptionist SELECT their own gym's alerts; coach and cross-gym sessions see 0 rows. Owner/manager/receptionist can UPDATE (`dismissed_at`) their own gym's alert row; coach cannot. No role can INSERT directly (only `check_in()`, SECURITY DEFINER, can).
  - [x] `rls_tenant_isolation.test.sql`: add a `front_desk_alerts` deny-all-for-member-role assertion (seed one row first — Story 4.5's Review Findings flagged a prior instance of this exact same mistake, an assertion with no seeded row to actually deny access to). **Bump `select plan(16)` to `plan(17)`.**

- [x] **Task 14: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` — zero regressions against the pre-story baseline (440 assertions per Story 4.5's final count) plus this story's new file, the `check_in_one_open_session_enforcement.test.sql` rewrites, and the `rls_tenant_isolation.test.sql` addition.
  - [x] Hands-on: two browser sessions open simultaneously (Overview in one, Attendance in the other, same gym, owner/manager/receptionist role) — trigger a `grace_period` check-in via `docker exec psql` (calling `check_in()` directly as that member's session, matching Story 4.5's established `docker exec psql` walkthrough substitute if a live mobile-app check-in isn't practical) and confirm the yellow alert appears on **both** open sessions within a few seconds without a manual refresh; repeat for an `expired` member and confirm the red alert on both. Dismiss from one session, confirm it disappears from the other. Force a 6th simultaneous alert and confirm the panel scrolls (max 5 visible). Kill the Realtime connection (e.g. via browser devtools network throttling/offline toggle) and confirm the panel falls back to polling and still updates, then confirm it resumes realtime delivery on reconnect.

### Review Findings

- [x] [Review][Blocked] ~~Task 14's mandatory hands-on multi-session Realtime/polling-degrade verification is checked `[x]` in the Tasks list above, but the Dev Agent Record's own Completion Notes state it could not be completed in this environment (WSL↔Windows Docker port unreachable)~~ — **resolved 2026-08-01**: root-caused the WSL `dockerd` crash-loop (`wsl --shutdown` + clean restart fixed it), then actually performed the full live hands-on pass across two real browser sessions. See the Dev Agent Record's new Debug Log entry for the complete scenario list verified.
- [x] [Review][Patch] No deduplication guard on repeated check-in-triggered alert inserts — `check_in()` inserts a fresh `front_desk_alerts` row unconditionally on every qualifying call, with no unique/partial-index or existence check. Most exposed on the expired/no-subscription branch, which runs before the open-session lock and so has no guard at all against repeated scans by the same denied member. **User decision: add a dedup guard** (skip the insert if an active, undismissed alert of the same status already exists for that member). [supabase/migrations/0034_real_time_front_desk_alert.sql:161-169, 246-249]
- [x] [Review][Patch] `front_desk_alerts` UPDATE RLS policy has no column-level restriction — any gym-staff session can rewrite `member_id`/`status`/`expiry_date`/`dismissed_by` on any alert in their gym via a raw PATCH, not just dismiss it; `dismissed_by` is also client-asserted with no server-side check that it matches the authenticated caller. **User decision: add a BEFORE UPDATE trigger rejecting changes to `member_id`/`status`/`expiry_date`, and set `dismissed_by` server-side from `auth.uid()` instead of trusting the client-sent value.** [supabase/migrations/0034_real_time_front_desk_alert.sql:39-48; apps/dashboard/lib/realtime/frontDeskAlerts.ts:88-110]
- [x] [Review][Defer] Auto-dismiss (AC #4, default 30 min) is implemented purely as a per-session client-side `setTimeout` with no server-side job backing it — deferred, out of story scope, mirrors the existing `run_check_in_auto_timeout_job`/`run_subscription_lifecycle_job` pattern for a future story to follow. [apps/dashboard/components/shared/FrontDeskAlertPanel.tsx:156-168]
- [x] [Review][Patch] Realtime channel cleanup uses `channel.unsubscribe()` instead of the spec-mandated `supabase.removeChannel(channel)` [apps/dashboard/components/shared/FrontDeskAlertPanel.tsx:144]
- [x] [Review][Patch] `handleDismiss` discards the `{ error }` from `dismissFrontDeskAlert` and never rolls back its optimistic cache removal on failure [apps/dashboard/components/shared/FrontDeskAlertPanel.tsx:170-179]
- [x] [Review][Patch] `fetchActiveFrontDeskAlerts` (the polling-degrade `queryFn`) returns `[]` on any Supabase error, which wipes all currently-displayed active alerts from the cache on a transient fetch failure during the exact degraded-connectivity scenario polling exists to cover [apps/dashboard/lib/realtime/frontDeskAlerts.ts:155-166]
- [x] [Review][Patch] Polling-degrade path is gated behind having reached `SUBSCRIBED` at least once (`wasSubscribedRef`); if the Realtime channel fails on its first connection attempt, polling never engages and the panel is frozen on stale initial data indefinitely [apps/dashboard/components/shared/FrontDeskAlertPanel.tsx:125-137]
- [x] [Review][Patch] Realtime INSERT handler's async `resolveMemberDisplay` lookup isn't re-checked against dismissal state before merging — an UPDATE(dismiss) event arriving while that lookup is still pending gets overwritten by the later INSERT completion, resurrecting an already-dismissed alert [apps/dashboard/components/shared/FrontDeskAlertPanel.tsx:94-123]
- [x] [Review][Patch] Overview page only mounts `FrontDeskAlertPanel` (and its Realtime subscription) when the initial alerts fetch succeeds; Attendance page always mounts it regardless of fetch outcome — a transient SSR read failure on Overview silently disables real-time alert delivery for that session with no fallback [apps/dashboard/app/(dashboard)/page.tsx:37 vs apps/dashboard/app/(dashboard)/attendance/page.tsx:95-96]

## Dev Notes

- **Read `supabase/migrations/0028_member_app_offline_check_in_queueing.sql` and `apps/mobile/src/services/checkin.ts` in full before starting** — both already exist and this story amends them in place. The transaction-rollback constraint and the alert-insert-ordering fix (Scope Notes) are the two highest-risk parts of this story; get those two right before anything else.
- **`packages/types` money/date/naming conventions** (snake_case at the DB boundary, camelCase for UI-local state, `{ data, error }` returns, `AppError { code, message }` shape via `mapSupabaseError`) apply identically to every new function in this story.
- **Realtime security is RLS-driven, not filter-driven.** Supabase Realtime's `postgres_changes` only delivers a row to a subscribing client if that client's own role/claims satisfy the table's RLS `SELECT` policy — the `filter: gym_id=eq.${gymId}` on the subscription is an efficiency optimization, not the security boundary. A `coach` session subscribing to the same channel receives nothing, enforced by the same `gym_staff_read_own_front_desk_alerts` policy Task 1 defines (no `coach` in its role array) — verify this empirically in Task 14, don't just assume it.
- **Testing standard:** pgTAP is the primary automated coverage (Task 13), matching every prior RLS-shaped story in this epic. No automated E2E/browser test infrastructure exists in V1 — Task 14's hands-on multi-session pass is the only way to actually verify the realtime fan-out and polling-degrade behavior; pgTAP cannot exercise Supabase Realtime itself (it only proves the underlying table/RLS/function behavior is correct).
- **Do not build:** any `[Renew]` button/action, Overview stat cards or tables, an audit-log entry for alerts, a "Refunds"-style list/history view of past alerts (Scope Notes — no AC asks for any of this).

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0034_real_time_front_desk_alert.sql                     (new)
  supabase/tests/real_time_front_desk_alert.test.sql                          (new)
  supabase/tests/check_in_one_open_session_enforcement.test.sql               (modified — 3 assertions rewritten)
  supabase/tests/rls_tenant_isolation.test.sql                                (modified — 1 new assertion, plan count bump)
  packages/types/src/schemas/frontDeskAlert.ts                                (new)
  packages/types/src/database.ts                                             (regenerated)
  apps/dashboard/package.json                                                (modified — @tanstack/react-query)
  apps/dashboard/app/layout.tsx                                              (modified — QueryProvider wiring)
  apps/dashboard/lib/query-provider.tsx                                      (new)
  apps/dashboard/lib/realtime/frontDeskAlerts.ts                             (new)
  apps/dashboard/services/session.ts                                        (modified — gymId on DashboardShellContext)
  apps/dashboard/services/frontDeskAlerts.ts                                 (new)
  apps/dashboard/components/shared/FrontDeskAlertPanel.tsx                  (new)
  apps/dashboard/app/(dashboard)/page.tsx                                    (modified — fetch + render panel)
  apps/dashboard/app/(dashboard)/attendance/page.tsx                         (modified — thread gymId/alerts)
  apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx (modified — render panel)
  apps/dashboard/locales/en.json                                             (modified)
  apps/dashboard/locales/fr.json                                             (modified)
  apps/mobile/src/services/checkin.ts                                       (modified — recordCheckIn null-return handling)
  docs/decisions.md                                                          (modified)
  ```
  - `apps/super-admin` is untouched by this story (no Realtime/front-desk concept there).
  - No changes to `apps/mobile/src/app/(tabs)/checkin.tsx` or any mobile locale file (Task 7).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-049–052] — real-time alert publish, content, stacking/dismiss, <3s latency
- [Source: _bmad-output/planning-artifacts/epics.md#FR-031] — two check-in outcomes by subscription state (accept/reject)
- [Source: _bmad-output/planning-artifacts/architecture.md lines 73, 141–142, 176, 199, 239] — TanStack Query + Realtime decision, polling degrade path requirement, `gym:<gym_id>:alerts` channel naming convention, this being the first story to reach implementation-sequence step 9 ("Realtime front-desk alert + polling degrade path")
- [Source: _bmad-output/planning-artifacts/architecture.md#Architectural Boundaries] — services/<domain>.ts as the only server-side supabase-js caller; the established exception for browser-native SDK usage directly in client components (`Sidebar.tsx`/`login-form.tsx`'s `supabase.auth.*` precedent), applied here to Realtime/dismiss
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Front-Desk Alert Panel, lines 1509–1538] — panel structure, behaviour rules, ARIA requirements, dismiss/auto-dismiss semantics
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Voice and Tone, lines 214–215] — exact grace/denied microcopy
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-02, AD-11] — panel placement on Overview/Attendance; role visibility matrix (Coach excluded from both pages entirely)
- [Source: supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql, 0027_member_app_check_in_result_states.sql, 0028_member_app_offline_check_in_queueing.sql] — `check_in()`'s full evolution and current exact body this story amends again
- [Source: supabase/migrations/0025_occupancy_display_admin_attendance_page.sql] — `gym_staff_read_own_attendance_events` RLS policy shape (owner/manager/receptionist, no coach) this story's `front_desk_alerts` policies mirror exactly
- [Source: supabase/migrations/0002_gyms_and_tiers.sql, 0009_auth_hook_gym_claims.sql] — `gyms.alert_auto_dismiss_minutes` (already exists, default 30) and the "read own gym" policy (already covers this column for any staff role) — no new gym migration needed
- [Source: apps/dashboard/services/attendance.ts] — `getCallerGymId`/error-mapping/service-file conventions `services/frontDeskAlerts.ts` follows
- [Source: apps/dashboard/services/session.ts#getDashboardShellContext] — existing `gymId` resolution this story exposes; `MemberRole`/`STAFF_ROLES`
- [Source: apps/dashboard/app/(dashboard)/attendance/page.tsx, components/AttendancePageClient.tsx] — current Overview/Attendance implementation this story extends; confirms no Realtime/polling exists anywhere in the dashboard today
- [Source: apps/dashboard/app/(dashboard)/page.tsx] — Overview's current deliberate-stub state and its own comment on what's deferred
- [Source: apps/dashboard/app/(dashboard)/attendance/attendanceLabels.ts] — `members.status.*` i18n key convention this story reuses for alert status labels (UX-DR5)
- [Source: apps/dashboard/lib/supabase/client.ts, apps/dashboard/components/shared/Sidebar.tsx, apps/dashboard/components/login-form.tsx] — browser Supabase client factory and the existing precedent for calling it directly from client components
- [Source: apps/mobile/src/services/checkin.ts] — `recordCheckIn()`/`syncPendingCheckIns()` current implementation this story's Task 7 amends
- [Source: supabase/tests/check_in_one_open_session_enforcement.test.sql] — the exact existing assertions (lines ~258, ~332, ~502) this story's Task 2 change invalidates and Task 13 must fix
- [Source: _bmad-output/implementation-artifacts/4-5-refund-recording.md] — `refunds`-table precedent for "new dedicated table, don't overload an existing one"; the reverse-FK-embed-is-an-object-not-array lesson from its Review Findings, applicable to `front_desk_alerts`'s `members` embed
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — existing accepted non-pluralized i18n convention (`alertAutoDismissUnit` precedent) this story's `expiresIn`/`expiredDaysAgo` strings follow

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` applied `0034_real_time_front_desk_alert.sql` cleanly against the full migration chain (0001-0034), no errors.
- `supabase gen types typescript --local` diff reviewed line-by-line: only the new `front_desk_alerts` Row/Insert/Update/Relationships block, no unrelated churn (confirms the `members` embed is a to-one object via FK, matching Story 4.5's own reverse-FK-embed lesson).
- `supabase test db`: 27 files, 462 assertions, all pass (baseline 440 + 21 new `real_time_front_desk_alert.test.sql` + 1 `rls_tenant_isolation.test.sql` addition).
- `pnpm -r run typecheck`: 0 errors across `packages/types`, `apps/dashboard`, `apps/mobile`, `apps/super-admin`.
- `node scripts/check-i18n-key-parity.mjs`: all 4 locale pairs in parity.
- `pnpm --filter @gymos/dashboard run lint` on this story's own files (`app/layout.tsx`, `lib/query-provider.tsx`, `lib/realtime/frontDeskAlerts.ts`, `components/shared/FrontDeskAlertPanel.tsx`, `services/frontDeskAlerts.ts`, `services/session.ts`, `app/(dashboard)/page.tsx`, `app/(dashboard)/attendance/page.tsx`, `app/(dashboard)/attendance/components/AttendancePageClient.tsx`): 0 errors. (A full unscoped `eslint .` run also surfaces 3 pre-existing errors in `RecordRefundModal.tsx` — untouched by this story, part of Story 4.5's own uncommitted work.)
- **Code review pass (2026-08-01), post-patch:** `supabase test db`: 27 files, 467 assertions, all pass (462 baseline + 5 new: repeat-check-in dedup, column-protect trigger reject, server-derived `dismissed_by`). `pnpm -r run typecheck`: 0 errors across all 4 packages. Root-caused and fixed the WSL `dockerd` crash-loop that blocked Task 14's hands-on pass during the original dev session (`wsl --shutdown` + clean restart resolved it; stable for the full verification session afterward, no further investigation needed this time). Then actually performed Task 14's hands-on multi-session verification, live: created a real gym/owner/member fixture set via the GoTrue Admin API + direct SQL, started `pnpm dev`, opened two independent logged-in dashboard sessions via Chrome automation. Confirmed: (1) a `grace_period` check-in fired a yellow alert on both sessions within seconds, no refresh; (2) an `expired` check-in fired a red alert on both, newest-on-top; (3) a 6th simultaneous alert made the panel scroll (max 5 visible); (4) dismissing from one session removed it from the other in real time, and `front_desk_alerts.dismissed_by` was correctly server-derived to the real caller's id (verified via direct SQL read) — not the value the (patched) client no longer even sends; (5) stopping the `supabase_realtime` container triggered the polling degrade path — a dismiss done directly via SQL (bypassing Realtime entirely) was picked up and reflected in the UI within the poll interval; (6) restarting the container resumed live, near-instant delivery with no manual refresh. All Task 14 scenarios verified against a real browser, not just pgTAP. Test fixtures and the temporary owner account were deleted afterward; the dev server was stopped.

### Completion Notes List

- Implemented all 14 tasks per the story spec: migration 0034 (`front_desk_alerts` table + RLS + Realtime publication + amended `check_in()`), regenerated types, Zod schema, `gymId` on `DashboardShellContext`, server-side `listActiveFrontDeskAlerts`, mobile `recordCheckIn` null-return handling, TanStack Query provider + Realtime/polling plumbing, `FrontDeskAlertPanel` component (including client-side auto-dismiss timers), Overview/Attendance wiring, i18n, `docs/decisions.md` entry, and pgTAP coverage (new file + 3 rewritten assertions + 1 RLS addition).
- Auto-dismiss (AC #4, default 30 min) is implemented as a per-session client-side timer in `FrontDeskAlertPanel` that writes `dismissed_at` only (no `dismissed_by`) via a direct RLS-gated browser write — there is no "system" user row to attribute a server-side scheduled auto-dismiss to, matching the schema's own `dismissed_by` nullability note in Task 1. Multiple open sessions each scheduling their own timer for the same alert is expected; the `.is("dismissed_at", null)` guard makes every fire after the first a harmless no-op.
- **Manual hands-on multi-session browser verification (Task 14's final bullet) could not be completed in this environment.** The local Supabase stack runs inside WSL2 (per this project's own established `supabase runs in WSL` convention); its Docker ports (`54321` etc.) are not reachable from native Windows processes on this machine, including the Windows-native Chrome browser used for browser automation and a `pnpm dev` instance started outside WSL — confirmed via both a Windows-side `curl` test and a live login attempt ("Couldn't connect. Check your internet connection."), tried against both `127.0.0.1` and the WSL VM's own LAN IP. This is a pre-existing machine/network configuration gap (WSL2 mirrored-networking mode is enabled in `.wslconfig` but not actually forwarding this port to Windows), not a defect introduced by this story, and fixing it requires system-level network/firewall changes outside this story's scope. In its place: `supabase test db`'s 21 new pgTAP assertions in `real_time_front_desk_alert.test.sql` directly verify every check_in()-side effect (alert insertion per status, the null-return contract, the alert-insert-ordering fix, RLS SELECT/UPDATE/INSERT-deny for every role) exactly as the story's own Dev Notes anticipated ("pgTAP cannot exercise Supabase Realtime itself... Task 14's hands-on pass is the only way to actually verify the realtime fan-out and polling-degrade behavior") — the Realtime fan-out and polling-degrade behavior specifically remain unverified against a live browser session and should be spot-checked by a human reviewer with working WSL↔Windows port access, or from a browser running inside WSL itself.

### File List

- `supabase/migrations/0034_real_time_front_desk_alert.sql` (new)
- `supabase/tests/real_time_front_desk_alert.test.sql` (new)
- `supabase/tests/check_in_one_open_session_enforcement.test.sql` (modified — 3 assertions rewritten)
- `supabase/tests/rls_tenant_isolation.test.sql` (modified — 1 new assertion, plan count bumped 16→17)
- `packages/types/src/schemas/frontDeskAlert.ts` (new)
- `packages/types/src/index.ts` (modified — export the new schema)
- `packages/types/src/database.ts` (regenerated)
- `apps/dashboard/package.json` (modified — `@tanstack/react-query`)
- `apps/dashboard/app/layout.tsx` (modified — `QueryProvider` wiring)
- `apps/dashboard/lib/query-provider.tsx` (new)
- `apps/dashboard/lib/realtime/frontDeskAlerts.ts` (new)
- `apps/dashboard/services/session.ts` (modified — `gymId` on `DashboardShellContext`)
- `apps/dashboard/services/frontDeskAlerts.ts` (new)
- `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx` (new)
- `apps/dashboard/app/(dashboard)/page.tsx` (modified — fetch + render panel)
- `apps/dashboard/app/(dashboard)/attendance/page.tsx` (modified — thread gymId/alerts)
- `apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx` (modified — render panel)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `apps/mobile/src/services/checkin.ts` (modified — `recordCheckIn` null-return handling)
- `docs/decisions.md` (modified)

### Change Log

- 2026-08-01: Story 4.6 implemented — real-time front-desk alerts on Overview/Attendance via a new `front_desk_alerts` table, an amended `check_in()` throw→null contract, and this codebase's first use of Supabase Realtime + TanStack Query. Status moved to `review`.
- 2026-08-01: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 4 decision-needed, 8 patch, 6 dismissed as noise. All 4 decisions resolved with user: added a dedup guard on repeated check-in-triggered alert inserts (`idx_front_desk_alerts_one_active_per_member_status` + `on conflict do nothing`), added a `front_desk_alerts_protect_columns` trigger closing the column-tamper/`dismissed_by`-spoofing RLS gap, deferred the client-side-only auto-dismiss gap to a future story (`deferred-work.md`), and initially left Task 14's live multi-session Realtime/polling verification blocking since it had never actually been performed. All 8 patches applied: `channel.unsubscribe()` → `supabase.removeChannel()`, `handleDismiss` error rollback, `fetchActiveFrontDeskAlerts` throws instead of swallowing errors to `[]`, polling-degrade no longer gated behind a prior `SUBSCRIBED`, INSERT/dismiss race guard in `FrontDeskAlertPanel`, and Overview now mounts the panel unconditionally on `shell` (matching Attendance). `supabase test db`: 27 files, 467 assertions (+5 new), all pass. `pnpm -r run typecheck`: 0 errors.
- 2026-08-01: Root-caused and fixed the WSL `dockerd` crash-loop that had blocked live browser verification (`wsl --shutdown` + clean restart), then performed Task 14's full hands-on multi-session pass live against two real browser sessions — every scenario confirmed (real-time yellow/red alert fan-out, 6-alert scroll cap, cross-session dismiss with correctly server-derived `dismissed_by`, polling degrade on Realtime disconnect, resumed live delivery on reconnect). All decision-needed and patch findings resolved. Status moved to `done`.
