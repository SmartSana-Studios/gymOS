---
baseline_commit: be642d0d547b2b190b513096cc3a125ec8604732
---

# Story 17.1: Staff Overview — Operational Cards & Live Tables (AD-02)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym Owner, Manager, or Receptionist,
I want the Overview to show what is happening in my gym right now,
so that the first screen I open answers "who is here, who needs attention, and what have we taken this month" without navigating anywhere.

*Delivers the AD-02 spec written in the 2026-07-04 UX pass and deferred by Story 4.6. No new UX design required. Migration 0095. Launch-blocking — this is the first screen a new gym Owner sees.*

## Acceptance Criteria

1. `apps/dashboard/app/(dashboard)/page.tsx` renders AD-02's specified content beneath the existing Front-Desk Alert Panel: a three-card stat row (Checked in now / Expiring this week / Revenue this month), then the Currently Checked-In table, then the Expiring This Week table. The `overview.body` placeholder string is deleted from `apps/dashboard/locales/en.json:40` and `fr.json:40`, and from **both** of its render sites in `page.tsx` — `OverviewData` (line 53) *and* `OverviewFallback` (line 64), which is easy to miss. `git grep overview.body -- apps/` returns nothing afterwards (the planning artifacts under `_bmad-output/` keep the string on purpose — an unscoped `git grep` will always hit `epics.md` and `sprint-change-proposal-2026-09-09.md`, so scope it to `apps/`). `overview.title` and the separate `nav.overview` key (`en.json:3`) both stay.

2. Each of the two tables and its matching card is fed by **ONE** service call, not two. `getCurrentlyCheckedIn()` (`services/attendance.ts:145`) returns `{ rows, total, page }` and `listSubscriptions({ status: "expiring_soon" })` (`services/subscriptions.ts:302`) returns `{ rows, total }` — `total` feeds the card, `rows.slice(0, 10)` feeds the table, per AD-02's "max 10 rows". Neither service takes a limit parameter (`ATTENDANCE_LOG_PAGE_SIZE = 50`, `SUBSCRIPTIONS_PAGE_SIZE = 25` are module constants), so the slice happens at the call site. Do **not** add a limit param to either service, and do **not** call either service twice.

3. "Expiring this week" is computed from the `expiring_soon` **status**, never a hand-rolled 7-day date filter. `0021_subscription_lifecycle_cron.sql:80-85` is the single definition ("still active, expiry within 7 days"), maintained by the nightly cron job, so the card and its `/subscriptions?status=expiring_soon` click-through target read from the same source and cannot drift apart.

4. Month-to-date revenue is computed by a database aggregate — new migration `supabase/migrations/0095_gym_revenue_mtd.sql`, function `gym_revenue_mtd()` — and **never** by fetching payment rows and summing them client-side. `supabase/config.toml:18` sets `max_rows = 1000`, which truncates any row fetch silently and without error; a gym exceeding 1,000 payments in a month would otherwise be shown an understated figure with no indication anything was wrong.

5. `gym_revenue_mtd()` returns `sum(payments.amount) - sum(refunds.amount)`, both scoped to `gym_id = private.gym_id()` and both bounded to the current calendar month **in the gym's local timezone**. `payments` is filtered to `status = 'verified'` only — `payment_status` is `('pending','processing','verified','flagged')` (`0001_extensions_and_enums.sql:20`); `pending`/`processing` is money not yet confirmed and `flagged` is money under dispute. `refunds.amount` is stored **positive** (`0033_refund_recording.sql:20`, `constraint refunds_amount_positive check (amount > 0)`), so it must be subtracted, not summed in. Both sums use `coalesce(..., 0)` so a gym with no activity returns `0`, never `NULL`. **The `+ interval '1 month'` must be added to the gym-local `timestamp`, inside the `date_trunc(...)` expression, and only then converted back with `at time zone`.** Adding it to the resulting `timestamptz` instead runs the month arithmetic in the session timezone (UTC for PostgREST) and silently loses days: measured against this repo's own Postgres, for Africa/Douala the wrong form ends March at `2026-03-28 23:00+00` instead of `2026-03-31 23:00+00` — **three days of revenue dropped, with no error** — and loses one day in May, July, October and December. It is correct in September, which is exactly why a spot-check today would not catch it.

6. `gym_revenue_mtd()` is **`SECURITY INVOKER`** (the default — do not write `security definer`) and `stable`. RLS stays the authorization boundary (AD-1): `gym_staff_read_own_payments` (owner/manager/supervisor/receptionist, per `0093:94-95`) and `gym_staff_read_own_refunds` (same list, per `0093:111-112`) already grant exactly the AD-02 audience, and the `tenant_active_gate` RESTRICTIVE policy on both tables (`0073:123`, `0073:135`) already returns zero rows for a suspended gym. Consequences the dev agent must not undo: the function needs **no** `private.current_gym_status()` suspension guard, adds **no** new privilege, and must **not** be added to `supabase/tests/suspension_rpc_coverage.test.sql` (that meta-test scans `SECURITY DEFINER` functions that *write* gated tables). It still carries explicit `revoke execute on function gym_revenue_mtd from public;` + `grant execute on function gym_revenue_mtd to authenticated;` per `0087_list_super_admins.sql:62-63`'s discipline — do not copy `0011`'s omission of those. It takes **no arguments**: the gym is resolved server-side from `private.gym_id()`, matching every other RPC in this codebase. Note the function makes a **third** RLS-gated read besides `payments` and `refunds` — `gyms`, for the timezone. That works today because `"read own gym"` (`0009_auth_hook_gym_claims.sql:154`, `using (id = private.gym_id())`) carries no role predicate, and `gyms` deliberately carries no `tenant_active_gate` so both apps can still detect a suspension. If the `gyms` row is ever not visible, the month bounds are undefined and the figure would silently read `0` — the `coalesce(..., 0)` wrapper around each subquery is what keeps that a clean `0` rather than a `NULL`. Writing `security invoker` explicitly is fine; writing `security definer` is not.

7. The month window is `payments.created_at` / `refunds.created_at`. **There is no `verified_at` or `paid_at` column on `payments`** — `created_at` (`0005_payments.sql:17`) is the only timestamp, and every row is inserted `pending`/`processing` and later UPDATEd to `verified` (`0031_manual_payment_verification_queue.sql:22-33`), so `created_at` is initiation time. The accepted consequence — a payment initiated on the last day of a month and verified on the first of the next counts into the earlier month — is recorded in the migration's header comment. Do **not** add a `verified_at` column or a backfill trigger: that is a schema change with unknowable historical backfill semantics and is out of this story's scope. FR-143's own wording ("refunds **recorded** in the same period") and EXPERIENCE.md's ("recorded in the same calendar month") both describe record-date bucketing, which is what this delivers.

8. Card click-through targets: "Checked in now" → `/attendance`; "Expiring this week" → `/subscriptions?status=expiring_soon` (works today with zero changes — `subscriptions/page.tsx:58-80` reads the param and echoes it back into the filter `<select>`); "Revenue this month" → `/payments`, **unfiltered**. The month filter is a documented, deliberate deviation from the epic's "filtered to the current month": `payments/page.tsx:21-27` takes no `searchParams` prop at all, and the page renders only the pending-verification queue — `page.tsx:11-12` records that AD-09's "All Payments" ledger is Scope-Note-excluded, so there is no ledger of verified payments for a month filter to filter. Adding one is a separate story. Plain `/payments` satisfies FR-143 ("Every card links through to the full page for its metric"). Record this deviation in `_bmad-output/implementation-artifacts/deferred-work.md`.

9. All three cards link for every role that can reach AD-02, including Receptionist, with no role-conditional linking. A Receptionist has no `/subscriptions` sidebar item (`Sidebar.tsx:41`, roles `manager/supervisor/owner`) but `gym_staff_read_own_subscriptions` does grant them the read (`0093:122-123`), and `subscriptions/page.tsx:16-31` already documents this app's "Sidebar hides it, RLS is the real gate" precedent. Do not invent a new role gate here — no AC asks for one.

10. Polling: the stat values refresh on page load and every 60 seconds. Implement as a small `"use client"` component that calls `router.refresh()` on a 60s `setInterval` and clears it on unmount. It must **not** touch, wrap, replace, or duplicate `FrontDeskAlertPanel`'s Supabase Realtime subscription, and must **not** be unified with that panel's `POLL_INTERVAL_MS = 5000` degrade poll (`FrontDeskAlertPanel.tsx:26`) — those are two different mechanisms with two different purposes. Because this page now hosts `RenewalModal` and the check-out dialog (Task 6) — and `FrontDeskAlertPanel` already opens `RenewalModal` here — the interval must not yank a modal out from under the user: key every table row by its stable id, and skip the tick while a modal is open (an early `return` in the interval callback). Verify by hand that a pending mobile-money renewal survives a full 60s tick. The panel keeps behaving exactly as Story 4.6 shipped it: still mounted whenever `shell` resolves regardless of whether the alerts fetch succeeded (`page.tsx:18-22`, a Story 4.6 review finding), still subscribing on `[gymId]` only, still receiving a stable `handleRenewed` identity.

11. Per-surface failure isolation. Every service function in this codebase returns `{ data, error }` and never throws for expected errors (AD-9), so a `Promise.all` of the three reads cannot reject — each result carries its own `error`. Branch on each one independently: a failed revenue aggregate renders an error state in the revenue card **only**, and the Currently Checked-In table still renders. Follow `payments/page.tsx:29-55`'s exact discipline (hard-fail only on the reads the page cannot exist without; `console.error` + degrade for the rest). Never let one failure blank the page.

12. Empty states, verbatim per AD-02 (`EXPERIENCE.md:2215-2216`): the checked-in table shows "No one is checked in right now." (the key `attendance.emptyCheckedIn` already carries this exact string — reuse it, do not add a duplicate) and the expiring table shows "No members expiring in the next 7 days." (new key).

13. Loading: 3 skeleton stat cards and 5 skeleton rows per table, using the house idiom `<div className="h-N w-M animate-pulse rounded bg-muted" />` (`attendance/loading.tsx` is the two-table precedent). The skeleton replaces the current `OverviewFallback` **inside `page.tsx`** — do **NOT** create `app/(dashboard)/loading.tsx`. That path is the route-group root and its boundary would also cover child routes that have no `loading.tsx` of their own (e.g. `/settings`), showing an Overview skeleton while navigating elsewhere. `page.tsx`'s existing `<Suspense fallback={<OverviewFallback />}>` shape is already correct and is what gets upgraded. This is a deliberate, reasoned deviation from the epic AC's literal "`<Suspense>` + `loading.tsx`" wording: every other route's `loading.tsx` sits at a leaf, whereas `(dashboard)/loading.tsx` would sit at the route-group root. Record it alongside AC #8's deviation.

14. Both `apps/dashboard/locales/en.json` and `fr.json` carry every new key, and `node scripts/check-i18n-key-parity.mjs` passes. New strings follow the established one-namespace-per-route shape (`overview.cards.*`, `overview.tables.*`) and reuse `members.status.*` for status badges rather than redefining them. Note the parity script checks key **presence only** — it will not catch an untranslated French value, so write real French.

15. A shared `StatCard` is added at `apps/dashboard/components/ui/stat-card.tsx` and used by all three cards — not three bespoke divs. It is a presentational, server-renderable component (no `"use client"`; `next/link` works in Server Components) with props `{ label: string; value: string; href: string; tone?: "default" | "alert" }`, wrapping the whole card in a `<Link>` so the entire tile is the click target. `value` is a **pre-formatted string** supplied by the caller — `StatCard` does no number or currency formatting, so it stays locale-agnostic and Story 17.2 reuses it unchanged (17.2 needs `tone="alert"` for its "At risk" card). Use `cn()` from `@/lib/utils` for the `tone` variant, as every other `components/ui/` primitive does. Deliberately **not** built on `components/ui/card.tsx`'s `<Card>` (`rounded-xl border bg-card shadow`, and a `p-6` header/content split): AD-02's stat tiles are the flatter tile, and `<Card>` here is used for auth forms and detail panels, not stat rows. Build it on the `rounded-md border p-4` + `text-sm text-muted-foreground` label + `text-2xl font-semibold` value idiom from `apps/super-admin/app/(admin)/metrics/page.tsx:38-53` — the repo's only stat-tile precedent, which is itself the three-bespoke-divs anti-pattern this AC exists to prevent repeating.

16. Every displayed number is formatted with an explicit locale — `value.toLocaleString(locale)`, never bare `toLocaleString()`. `PaymentsPageClient.tsx:93-95` documents this as a real shipped bug from Story 3.1's metrics page. The three **cards** are server-rendered, so their locale comes from `await getRequestLocale()`. The two **tables** must be `"use client"` components — they carry the Check Out and Renew actions, and an `onClick` in a Server Component is a build error — so they take their locale from `useTranslation()`'s `i18n.language`, matching `AttendancePageClient`/`SubscriptionsPageClient` and `formatLocalDate(dateOnly, locale)`. Neither may call bare `toLocaleString()`. Revenue renders as `XAF ` + the formatted integer (XAF is zero-decimal; `payments.amount` and `refunds.amount` are both `integer`). The figure can legitimately be **negative** in a month whose refunds exceed its verified takings — render it as-is with its minus sign rather than clamping to `0`; a clamp would hide exactly the situation an Owner most needs to see.

17. `packages/types/src/database.ts` gains the `gym_revenue_mtd` RPC entry (shape: `gym_revenue_mtd: { Args: never; Returns: number }`, inserted alphabetically beside `gym_member_count` at `:2047`). Use `Args: never` — that is what all 20 existing no-arg RPCs in this file use, `gym_effective_member_cap` at `:2046` being the adjacent precedent for the exact no-arg `.rpc()` call shape Task 3 needs. If `supabase gen types` emits `Record<PropertyKey, never>` instead, that is CLI-version drift that would rewrite all 20 entries — hand-add `Args: never` and note it rather than committing the churn. Prefer `supabase gen types typescript --local`; if the CLI's container path fails silently (this devcontainer has no outbound network from Docker — see `docs/deploy-runbook.md`), hand-add the entry and say so in Completion Notes.

18. pgTAP coverage in a new `supabase/tests/gym_revenue_mtd.test.sql`, following `refund_recording.test.sql`'s fixture style (own story-scoped UUID block, `begin;` / `select plan(N);` / `select * from finish();` / `rollback;`). It must prove, each with its own positive control: verified-only (a `pending` and a `flagged` payment in-window are excluded); net-of-refunds (a positive-amount refund reduces the figure); the month window (a prior-month payment is excluded — seed `created_at` explicitly); gym scoping (Gym B's payments do not appear in Gym A's figure); and that a receptionist session gets the same figure as the owner. The role-switching mechanics for the receptionist-vs-owner assertion are the non-obvious part: `set local role authenticated;` followed by `select set_config('request.jwt.claims', '{"sub":…,"role":"authenticated","gym_id":…,"app_role":"receptionist"}', true);` — see `refund_recording.test.sql:55-57,109-111,126-128`. The claims **must** carry `gym_id` or `private.gym_id()` returns NULL and every figure is `0`. Seed `created_at` explicitly on the prior-month row. Scope every assertion to this test's own fixtures — two shipped test files previously failed against any non-empty local database by counting platform-wide (`docs/decisions.md`, 2026-09-09 entry). If you add a suspended-gym assertion, seed that gym with `status = 'suspended'` **in its `insert into gyms`** — do **not** `update gyms set status = 'suspended'`. The `protect_super_admin_only_gym_columns` trigger (`0014_gym_settings_owner_access.sql:33,51`) silently does `new.status := old.status` for any non-super-admin caller, with no error and a reported `UPDATE 1`, so an UPDATE-based suspension test passes for the wrong reason. This was hit and diagnosed during story creation.

## Tasks / Subtasks

- [ ] Task 1 — Migration `0095_gym_revenue_mtd.sql` (AC: #4, #5, #6, #7)
  - [ ] `create function gym_revenue_mtd() returns bigint language sql stable set search_path = public, pg_temp` — `create function`, not `create or replace` (new object); no `begin;`/`commit;` wrapper (the applier supplies the transaction — zero migrations in this repo contain them)
  - [ ] Use this body **exactly** — it was compiled and smoke-tested against this repo's local Supabase schema during story creation. Note it is a pure `language sql` function with the month bounds inlined: an earlier draft used `v_month_start`/`v_month_end` variables, which do not exist in a plain SQL function (they would require `language plpgsql` and a `declare` block). Do not reintroduce them.

```sql
create function gym_revenue_mtd()
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(p.amount) from payments p, gyms g
      where g.id = private.gym_id()
        and p.gym_id = g.id
        and p.status = 'verified'
        and p.created_at >= (date_trunc('month', now() at time zone g.timezone) at time zone g.timezone)
        and p.created_at <  ((date_trunc('month', now() at time zone g.timezone) + interval '1 month') at time zone g.timezone)
    ), 0)
    -
    coalesce((
      select sum(r.amount) from refunds r, gyms g
      where g.id = private.gym_id()
        and r.gym_id = g.id
        and r.created_at >= (date_trunc('month', now() at time zone g.timezone) at time zone g.timezone)
        and r.created_at <  ((date_trunc('month', now() at time zone g.timezone) + interval '1 month') at time zone g.timezone)
    ), 0);
$$;

revoke execute on function gym_revenue_mtd from public;
grant execute on function gym_revenue_mtd to authenticated;
```

  - [ ] The `at time zone` round-trip is the idiom already used at `0056_quiet_gym_alert_opt_in_delivery.sql:509` and `0057_class_creation_scheduling.sql:245`, and the window is half-open `[start, end)` — never `between`. Verified for Africa/Douala (UTC+1): gym-local September resolves to `2026-08-31 23:00+00` through `2026-09-30 23:00+00`, so a payment at 00:30 local on Sep 1 counts in September and one at 00:30 local on Oct 1 does not
  - [ ] **Do not** write `security definer`. Do not add a `private.current_gym_status()` guard. Do not touch `suspension_rpc_coverage.test.sql`
  - [ ] `revoke execute on function gym_revenue_mtd from public;` then `grant execute on function gym_revenue_mtd to authenticated;` — both explicit
  - [ ] Header comment in the house style (see `0092`/`0094`): what this closes, why the aggregate rather than a client-side sum (`max_rows = 1000`), why `SECURITY INVOKER` rather than `DEFINER`, why `created_at` and what that costs at a month boundary, and why refunds subtract
  - [ ] Trailing `do $verify$ ... $verify$;` self-assertion block asserting the function exists and that `EXECUTE` is not granted to `PUBLIC`, with messages prefixed `'0095: '` — matching `0094`'s discipline

- [ ] Task 2 — Types (AC: #17)
  - [ ] Regenerate or hand-add `gym_revenue_mtd` in `packages/types/src/database.ts`; record which path was taken in Completion Notes

- [ ] Task 3 — Service function (AC: #4, #5, #11)
  - [ ] Add `getRevenueMtd(): Promise<{ data: number | null; error: AppError | null }>` to `apps/dashboard/services/payments.ts`
  - [ ] `const { data, error } = await supabase.rpc("gym_revenue_mtd");` → on error `return { data: null, error: await mapAndLog(error) }`; no `p_` args (the RPC takes none). Follow `services/billing.ts:50-72`'s exact shape
  - [ ] Do not pass a gym id — `private.gym_id()` resolves it server-side, matching every other `.rpc()` call site in this app

- [ ] Task 4 — `StatCard` (AC: #15)
  - [ ] Create `apps/dashboard/components/ui/stat-card.tsx`; no `"use client"`
  - [ ] Props `{ label, value, href, tone? }`; whole tile wrapped in `<Link href={href}>`; `tone="alert"` reserved for 17.2 (render it in the destructive/alert colour, and only when the caller asks — 17.1 never passes it)

- [ ] Task 5 — Rebuild `(dashboard)/page.tsx` (AC: #1, #2, #8, #11, #13, #16)
  - [ ] Keep the outer `export default function OverviewPage()` → `<Suspense fallback={<OverviewSkeleton />}><OverviewData /></Suspense>` shape (mandatory under `cacheComponents: true`, `next.config.ts:9`)
  - [ ] Replace `OverviewFallback` with `OverviewSkeleton`: 3 card skeletons + 2 × 5 row skeletons, house `animate-pulse` idiom. Do NOT add `app/(dashboard)/loading.tsx`
  - [ ] In `OverviewData`, extend the existing `Promise.all` with `getCurrentlyCheckedIn()`, `listSubscriptions({ status: "expiring_soon" })`, and `getRevenueMtd()`; keep `getDashboardShellContext()`, `listActiveFrontDeskAlerts()`, `canOfferMobileMoneyPayment()` exactly as they are
  - [ ] Render order: `<FrontDeskAlertPanel>` (unchanged, same props, same `{shell && ...}` gating) → `<h1>{t("overview.title")}</h1>` → stat-card row → checked-in table → expiring table. Delete the `overview.body` `<p>`
  - [ ] Branch on each result's own `error` independently; render a per-card / per-table error state, never a page-level blank
  - [ ] Leave a clear seam where 17.2's Manager-plus row 2 will slot in (its own `<Suspense>` beneath the row-1 cards) — do not build it here

- [ ] Task 6 — The two tables (AC: #2, #12, #16)
  - [ ] Currently Checked-In: columns Name (with the initial-avatar circle), Check-in time, Status badge, Check Out action, per AD-02. Reuse `attendance/attendanceLabels.ts`'s `STATUS_BADGE_CONFIG` + `resolveBadgeStatus` and the canonical table classes (`overflow-x-auto rounded-md border` / `w-full text-sm` / `border-b bg-muted/50 text-left` / `p-3 font-medium` / `border-b last:border-0` / `p-3`) from `AttendancePageClient.tsx:196-261`. Per this codebase's explicit per-file-copy discipline (`attendanceLabels.ts:4-9`), copy the label map into the Overview's own folder rather than importing across route folders — `subscriptionLabels.ts` was itself copied from `attendanceLabels.ts`, so copying is unambiguously the convention here
  - [ ] Expiring This Week: columns Name, Plan, Expiry date, Status badge, Renew button, per AD-02, mirroring `SubscriptionsPageClient.tsx:230-320`. Use `subscriptions/subscriptionLabels.ts`'s `STATUS_BADGE_CONFIG` for its badge — a 4-state map over exactly `subscription_status`, already keyed to `members.status.*`. `attendanceLabels.ts`'s 6-state map plus `resolveBadgeStatus` is for the checked-in table only
  - [ ] "View all →" links: `/attendance` and `/subscriptions?status=expiring_soon`
  - [ ] Dates: use `formatLocalDate`'s split-and-reconstruct approach (`SubscriptionsPageClient.tsx:63-66`) for `YYYY-MM-DD` expiry values — a bare `new Date("2026-09-30")` shifts a day under UTC parsing
  - [ ] Both tables are `"use client"` components under `app/(dashboard)/components/`; the server component fetches and passes rows plus `mobileMoneyEnabled` down as props
  - [ ] The checked-in table keeps `getCurrentlyCheckedIn()`'s existing check-in-time-ascending order (`attendance.ts:165`), per AD-02 — do not re-sort it
  - [ ] Both tables render at most 10 rows (`rows.slice(0, 10)`) while the cards show the full `total`
  - [ ] Renew: reuse `components/shared/RenewalModal.tsx` exactly as `SubscriptionsPageClient.tsx:348` already does. It was deliberately built standalone for this (its own header comment says so) and needs no new plumbing — its `mobileMoneyEnabled` prop comes from the `canOfferMobileMoneyPayment()` call already in `OverviewData`. Make `onRenewed` a `useCallback(..., [])`; see `FrontDeskAlertPanel.tsx:103` for why a stable identity matters here. Do not build a second renewal path
  - [ ] Check Out: reuse `attendance/components/CheckOutMemberConfirmDialog.tsx` with `AttendancePageClient.tsx:86,249,415-417`'s `checkingOutMember` state pattern. Do not build a second check-out path

- [ ] Task 7 — 60s polling (AC: #10)
  - [ ] Small `"use client"` component (e.g. `app/(dashboard)/components/OverviewAutoRefresh.tsx`) — `useEffect` + `setInterval(() => router.refresh(), 60_000)` + `clearInterval` on unmount; renders `null`
  - [ ] Mount it inside `OverviewData`. Do not add `refetchInterval`, do not create a TanStack query key (`["frontDeskAlerts", gymId]` is the panel's and must not be collided with), do not modify `FrontDeskAlertPanel.tsx` or `lib/realtime/frontDeskAlerts.ts` at all

- [ ] Task 8 — i18n (AC: #12, #14)
  - [ ] Delete `overview.body` from `en.json` and `fr.json`; add `overview.cards.*` and `overview.tables.*` to both
  - [ ] Reuse `attendance.emptyCheckedIn` for the checked-in empty state; add a new key for "No members expiring in the next 7 days."
  - [ ] `node scripts/check-i18n-key-parity.mjs` → clean. Watch the ESLint `i18next/no-literal-string` gate: it is `jsx-text-only`, so a hardcoded `aria-label` will pass CI silently (`eslint.config.mjs:22-38`) — still don't write one

- [ ] Task 9 — Tests (AC: #18)
  - [ ] `supabase/tests/gym_revenue_mtd.test.sql` per AC #18; run `supabase test db`
  - [ ] Vitest co-located test for `StatCard` (renders label/value, links to `href`, applies `tone="alert"` styling only when asked). Remember `globals` is NOT enabled — import `describe/it/expect/vi` from `vitest` explicitly (`vitest.setup.ts`)
  - [ ] If `page.tsx` gets a test, follow `(dashboard)/layout.gymSwitchRemount.test.tsx`'s technique for async Server Components: reach through the `<Suspense>` element to the async child and `await` it — no renderer needed

- [ ] Task 10 — Verify (AC: all)
  - [ ] `pnpm --filter @gymos/dashboard typecheck`, `lint`, `test`
  - [ ] `pnpm --filter @gymos/dashboard build` — must exit 0. Treat it as a general regression gate, not as proof the Suspense structure is right: `(dashboard)/layout.tsx:17` already wraps `children` in `<Suspense fallback={null}>`, and the Next docs accept "the component **or a parent**", so a boundary missing from `page.tsx` would bubble there rather than fail the build — blanking the whole dashboard chrome during streaming instead of erroring
  - [ ] `git grep overview.body -- apps/` → no hits (unscoped will always hit the planning artifacts)
  - [ ] `node scripts/check-i18n-key-parity.mjs` → clean
  - [ ] `supabase test db` → full suite green, not just the new file

## Dev Notes

- **Read `apps/dashboard/AGENTS.md` first.** Next.js here is **16.3.4**, with breaking changes vs. training data; the file directs you to `apps/dashboard/node_modules/next/dist/docs/` before writing routing code. Two concrete consequences already relied on by this story: `middleware.ts` is now `proxy.ts`, and `searchParams`/`params` are Promises.

- **`cacheComponents: true` (`next.config.ts:9`) is the single biggest build-breaking constraint.** Every cookie-backed Supabase read must sit inside an explicit `<Suspense>`. `spec-cache-components-suspense-boundary-fix.md` records the pass that established this — it fixed four *layouts*, where no ancestor boundary existed and `next build` genuinely did hard-fail. Inside `(dashboard)`, `layout.tsx:17`'s `<Suspense fallback={null}>` is already an ancestor of every page, so a page-level omission does **not** fail the build; it makes the suspension bubble up to that `null` fallback and blank the entire dashboard chrome during streaming. Quieter, and worse. `page.tsx`'s existing outer-sync-shell + Suspense-wrapped-async-child shape is already compliant — preserve it, and do not rely on the build to tell you if you break it.

- **Why `SECURITY INVOKER` for the aggregate, in full.** The obvious move is to copy `0040`/`0061`/`0087`'s `SECURITY DEFINER` shape. Don't. `payments` and `refunds` already carry SELECT policies covering exactly AD-02's audience (owner/manager/supervisor/receptionist, post-`0093`), and both carry `tenant_active_gate`. Under invoker rights the function inherits all of that for free: correct figure for staff, `0` for a suspended gym, `0` for a coach (not in either policy's role list — and 17.3 redirects coaches off this page anyway), and a member session would see only their own payments, which is not a leak. Under definer rights you would instead be adding a new privilege that bypasses RLS, which then needs its own suspension guard, its own role allowlist, and an entry in the `suspension_rpc_coverage.test.sql` audit — three ways to get it wrong in exchange for nothing. `max_rows` is a PostgREST response limit and does not apply to a `sum()` evaluated inside the function, so the invoker path loses none of the truncation protection that motivated the aggregate.

- **The invoker-rights design was verified empirically, not just reasoned about.** Against this repo's local Supabase, with the function above and fixtures for two gyms: an **owner** session returned `7500` (one `10000` verified payment in-window, minus a `2500` refund — correctly excluding a `pending` payment, a payment from two months ago, and another gym's `99000`); a **receptionist** session returned the same `7500`; a **coach** session returned `0` (not in either table's SELECT policy, which also proves RLS is genuinely being applied rather than silently bypassed); and an owner of a gym whose row carries `status = 'suspended'` returned `0`, confirming `tenant_active_gate` fires without any explicit guard in the function. `pg_proc` confirmed `prosecdef = false`, `provolatile = 's'`, `prorettype = bigint`, and `proacl = {postgres=X/postgres,authenticated=X/postgres}` — PUBLIC revoked. If your implementation deviates from these five results, the deviation is the bug.

- **The `is distinct from` NULL trap does not apply here, but know why.** `docs/decisions.md` (2026-09-09, Story 11.8) records that `private.current_gym_status() <> 'active'` fails *open* inside plpgsql because `NULL <> 'active'` is `NULL`. That rule binds any future guard you add to a `SECURITY DEFINER` function. This story adds no guard, so it does not arise — but do not "helpfully" add one with `<>`.

- **Refund attribution is by refund date, not payment date.** A refund recorded this month against a payment from last month reduces *this* month's figure. That is what FR-143 and EXPERIENCE.md both specify ("recorded in the same period"), and it is also the only thing expressible without a payment-date join. Say so in the migration comment so a future reader does not "fix" it.

- **Currency is not filtered.** `payments.currency` and `refunds.currency` both default `'XAF'` and there is no per-gym currency column on `gyms` (`0002:13-29`). V1 is single-currency; summing across currencies would be wrong the day that changes. Note it in the migration comment; do not add a filter that has nothing to filter.

- **`gyms.timezone` for date math is new ground in this repo.** The column exists (`0002:20`, default `'Africa/Douala'`, UTC+1, no DST) and `0056`/`0057` use it for *clock-time* windows, but every calendar-date query to date uses UTC `current_date` and cites the accepted gap at `0022_manual_renewal_reset.sql:60-64` / `services/attendance.ts:44-53`. This story closes that gap for revenue only, because the epic AC and EXPERIENCE.md's AD-02 V2 amendment both say "in gym-local time" explicitly. It matters: at UTC+1, a payment taken at 00:30 local on the 1st is 23:30 UTC on the last of the prior month. Do not "align with precedent" by switching to UTC — and do not widen the fix to other queries. Story 17.2's "New this month" must use this same window so the two cards describe the same period.

- **`getCurrentlyCheckedIn()` returns three fields, not two.** The epic text says both services return `{ rows, total }`; `getCurrentlyCheckedIn()` actually returns `{ rows, total, page }` (`attendance.ts:145-148`). `total` is the gym-wide open-session count regardless of page, so it is correct for the card even though `rows` is the first page of up to 50.

- **`listSubscriptions()` silently ignores an unrecognised `status`.** `applySubscriptionFilters` (`subscriptions.ts:283-293`) only applies the filter if the value is in `VALID_SUBSCRIPTION_STATUS_FILTERS`; an invalid value means *no filter*, i.e. every subscription. Pass the literal `"expiring_soon"`, not a variable that could drift.

- **Do not touch the Front-Desk Alert Panel.** Its Realtime channel (`gym:${gymId}:alerts`, `lib/realtime/frontDeskAlerts.ts:43`), its `[gymId]`-only effect deps with the deliberate `eslint-disable exhaustive-deps` (`FrontDeskAlertPanel.tsx:190-191`), its `staleTime: Infinity` + `initialData` query on key `["frontDeskAlerts", gymId]`, its `handleRenewed = useCallback(..., [])` stable identity (a Story 4.12 review finding — an unstable identity tears down `RenewalModal`'s payment-status subscription every render), and its "mount whenever `shell` resolves" gating are all load-bearing and separately review-earned. A 60s `router.refresh()` is safe against all of them: `gymId` is a string, `initialData` is ignored by TanStack Query after first mount, and the effect deps don't change — but verify the panel still behaves after wiring the poll.

- **`router.refresh()` preserves client state by design**, which is why `(dashboard)/layout.tsx:146` wraps children in `<Fragment key={shell.gymId}>`. That key also means a gym switch remounts everything below it, so any client state you introduce re-seeds correctly on switch. Don't add a second keying mechanism.

- **`/payments` genuinely cannot be filtered to a month today.** `payments/page.tsx` has no `searchParams` prop anywhere in the route folder, `listPendingPayments()` hard-filters `.eq("status","pending")` with no pagination and no date filter (`payments.ts:305-335`), and AD-09's "All Payments" ledger is explicitly Scope-Note-excluded from Story 4.3. AC #8 resolves this by linking to plain `/payments` rather than inventing a dead query param or expanding into a new ledger surface. This is the one place this story knowingly under-delivers the epic's literal text, and it is recorded rather than hidden.

- **No `Table` or `Skeleton` shadcn primitive exists** in `apps/dashboard/components/ui/` (contents: badge, button, card, checkbox, command, dialog, dropdown-menu, input, label, phone-input, popover, tabs). Tables are hand-rolled `<table>` markup everywhere; skeletons are inline `animate-pulse` divs. Do not `npx shadcn add table` — it would be the first, and this story does not need it.

- **`StatCard` in `components/ui/` cuts against the per-file-copy convention, deliberately.** This codebase duplicates helpers on purpose (`attendance.ts:22-26`, `attendanceLabels.ts:4-9`, `subscriptions.ts:218-220`). The epic's own last AC overrides that here because Story 17.2 must reuse the same card unchanged. `phone-input.tsx` (Story 16.1) is the precedent for a bespoke composite living in `components/ui/`.

- **17.1 and 17.3 both edit `(dashboard)/page.tsx`.** They are the heads of two independent chains meant to run in parallel (`epics.md:656`). 17.3 adds a coach redirect near the top of `OverviewData`; 17.1 rebuilds its body. Whichever lands second must rebase rather than overwrite — the redirect must survive, and it must stay *above* the new data fetches so a coach never pays for them.

- **Production is at migration `0094`** (deployed 2026-09-09 — `docs/decisions.md`'s 2026-09-09 entry and the `f28e4ac` sprint-status commit; `docs/runbooks/deploy-0090-0094.md`'s "not yet executed" header is stale). `0095` deploys together with Story 17.4's `0096` — the product owner decided on 2026-09-10 that 17.4 ships in the same release (see `epics.md`'s amended Epic 17 dependency-order paragraph), so plan one batch, not two. Deploys go through host `psql`, never `supabase db push` — the CLI's container commands fail silently and still exit 0 in this devcontainer. `scripts/deploy-0090-0094.sh` is the shape to copy: each migration in its own transaction with `ON_ERROR_STOP`, the `supabase_migrations.schema_migrations` row inserted in that same transaction.

- **Testing:** Vitest 4.1.10 + `@testing-library/react`, co-located `*.test.tsx`, `globals` **not** enabled (import from `vitest` explicitly). pgTAP in `supabase/tests/`, run by `supabase test db` (no npm script exists). Playwright e2e exists at `apps/dashboard/e2e/` but has no Overview spec and this story does not need one.

- **Cite `docs/decisions.md` by its dated heading, never by line number** — the file is newest-first and every new entry shifts them; three consecutive stories have broken citations this way.

### Project Structure Notes

- **New:** `supabase/migrations/0095_gym_revenue_mtd.sql`, `supabase/tests/gym_revenue_mtd.test.sql`, `apps/dashboard/components/ui/stat-card.tsx` (+ co-located test), `apps/dashboard/app/(dashboard)/components/OverviewAutoRefresh.tsx`, and the Overview's table/card components (place them under `app/(dashboard)/components/` — the route-group root has no `components/` folder yet; every sibling route keeps its own, so this follows the pattern rather than breaking it).
- **Modified:** `apps/dashboard/app/(dashboard)/page.tsx`, `apps/dashboard/services/payments.ts`, `apps/dashboard/locales/en.json`, `apps/dashboard/locales/fr.json`, `packages/types/src/database.ts`, `_bmad-output/implementation-artifacts/deferred-work.md`.
- **Explicitly unmodified:** `components/shared/FrontDeskAlertPanel.tsx`, `lib/realtime/frontDeskAlerts.ts`, `services/frontDeskAlerts.ts`, `services/attendance.ts`, `services/subscriptions.ts`, `components/shared/Sidebar.tsx`, `app/(dashboard)/loading.tsx` (must not be created), `supabase/tests/suspension_rpc_coverage.test.sql`, and every RLS policy — this epic modifies zero policies (`epics.md:658`).
- No conflict with the unified project structure: `services/<domain>.ts` (AD-7), a `SECURITY INVOKER` SQL function rather than a new API surface (AD-8), `{ data, error }` returns (AD-9), integer money with an explicit currency column (AD-16), and co-located tests + `supabase/tests/` pgTAP all hold.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 17.1: Staff Overview — Operational Cards & Live Tables (AD-02)]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 17: Launch Readiness — Overview Build-Out & Coach Portal Depth — scope boundary, zero RLS policies modified]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-09.md — Findings 1 and 5, and the Appendix]
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:553 FR-143]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:1044-1097 AD-02 + V2 amendment; :2215-2216 empty states; :2253-2254 loading]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md — AD-1, AD-7, AD-8, AD-9, AD-16]
- [Source: docs/decisions.md#2026-09-09 — First production deploy of the suspension work (prod head 0094; host psql, not `supabase db push`; decisions.md citation rot)]
- [Source: _bmad-output/implementation-artifacts/spec-cache-components-suspense-boundary-fix.md]
- [Source: apps/dashboard/app/(dashboard)/page.tsx:1-67]
- [Source: apps/dashboard/app/(dashboard)/layout.tsx:11-21,146]
- [Source: apps/dashboard/app/(dashboard)/payments/page.tsx:11-12,21-27,29-55]
- [Source: apps/dashboard/app/(dashboard)/subscriptions/page.tsx:16-31,37-80]
- [Source: apps/dashboard/app/(dashboard)/attendance/loading.tsx]
- [Source: apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx:196-261]
- [Source: apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx:63-66,113-133,230-320]
- [Source: apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx:79-81,93-95]
- [Source: apps/dashboard/components/shared/FrontDeskAlertPanel.tsx:26,72-82,103,112-191,238]
- [Source: apps/dashboard/lib/realtime/frontDeskAlerts.ts:36-57]
- [Source: apps/dashboard/components/shared/Sidebar.tsx:37-51]
- [Source: apps/dashboard/services/attendance.ts:9,44-53,145-224]
- [Source: apps/dashboard/services/subscriptions.ts:216-233,263,283-293,302-343]
- [Source: apps/dashboard/services/payments.ts:305-335]
- [Source: apps/dashboard/services/billing.ts:50-72 — canonical `.rpc()` shape]
- [Source: apps/super-admin/app/(admin)/metrics/page.tsx:38-53 — stat-tile idiom, and the three-bespoke-divs anti-pattern]
- [Source: apps/dashboard/next.config.ts:6-9; apps/dashboard/AGENTS.md]
- [Source: apps/dashboard/eslint.config.mjs:16-79; scripts/check-i18n-key-parity.mjs]
- [Source: supabase/config.toml:18 — max_rows = 1000]
- [Source: supabase/migrations/0001_extensions_and_enums.sql:20; 0002_gyms_and_tiers.sql:13-29; 0005_payments.sql:1-27 (created_at at :17)]
- [Source: supabase/migrations/0021_subscription_lifecycle_cron.sql:80-85 — expiring_soon definition]
- [Source: supabase/migrations/0022_manual_renewal_reset.sql:60-64 — the timezone gap this story closes for revenue]
- [Source: supabase/migrations/0031_manual_payment_verification_queue.sql:22-33 — every payment is inserted pending, verified by UPDATE]
- [Source: supabase/migrations/0033_refund_recording.sql:11-21,38-42 — positive amounts, receptionist-and-above SELECT]
- [Source: supabase/migrations/0056_quiet_gym_alert_opt_in_delivery.sql:509; 0057_class_creation_scheduling.sql:245 — `at time zone` idiom]
- [Source: supabase/migrations/0073_tenant_suspension_enforcement.sql:123,135 — tenant_active_gate on payments and refunds]
- [Source: supabase/migrations/0087_list_super_admins.sql:28,62-63 — search_path and revoke/grant discipline]
- [Source: supabase/migrations/0093_supervisor_manager_plus_access.sql:94-95,111-112,122-123 — post-0093 role lists]
- [Source: supabase/migrations/0011_super_admin_tier_gym_lifecycle.sql:80-134 — aggregate-function shape, and the revoke/grant omission not to copy]
- [Source: supabase/tests/refund_recording.test.sql — pgTAP fixture style]
- [Source: scripts/deploy-0090-0094.sh; docs/deploy-runbook.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
