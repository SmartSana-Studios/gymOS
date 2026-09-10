# Story 17.2: Staff Overview — Gym Health Cards (Manager-plus)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym Owner, Supervisor, or Manager,
I want a second row of cards showing how the gym is doing, not just what is happening this minute,
so that I can see membership growth and churn risk without building a report.

*Depends on Story 17.1 (reuses its `StatCard`, fills its row-2 seam). Extends AD-02 per EXPERIENCE.md's V2 amendment. **Migration 0097.** Zero RLS policies modified. Depth, not a launch blocker.*

*Four decisions were made with the product owner (smartsana) during story creation, 2026-09-10, and are already written into `epics.md` Story 17.2 and `EXPERIENCE.md` AD-02 V2: (1) a small migration 0097 for gym-local bounds, overriding the epic's original "No migration"; (2) "New this month" counts by `join_date`, not creation time; (3) "Active members" counts `active` + `expiring_soon`; (4) both status cards link to new named filters on `/subscriptions`. Do not re-litigate them; the reasoning is in Dev Notes.*

## Acceptance Criteria

1. **Manager-plus gate, absent from the DOM.** Row 2 renders only when `shell.role` is one of an explicit allowlist `["manager", "supervisor", "owner"]`, a flat literal like `Sidebar.tsx`'s role lists, **not** `role !== "receptionist"`, so a future role does not inherit management figures by default. For a Receptionist, or when `shell` is `null`, there is no row-2 component, no row-2 skeleton in either fallback, and **none of row 2's five reads runs**. A Coach never gets here, because Story 17.3's `OverviewGate` redirects first (`page.tsx:77-89`). This gate hides management information from the front desk; it is **not** an authorization boundary. RLS already lets a Receptionist read `subscriptions_current`, `members` and `class_sessions`, and measured on the local DB a receptionist session gets exactly the owner's four figures. Do not add a service-level role check, and do not touch any policy (`epics.md:658`, "This epic modifies zero RLS policies").

2. **Four cards, this order, via the shared `StatCard` unchanged:**

   | Label key | Value | `href` |
   |---|---|---|
   | `overview.cards.activeMembers` | Active members | `/subscriptions?status=active_or_expiring` |
   | `overview.cards.newThisMonth` | New this month | `/members` |
   | `overview.cards.todaysClasses` | Today's classes | `/classes` |
   | `overview.cards.atRisk` | At risk | `/subscriptions?status=at_risk` |

   `components/ui/stat-card.tsx` is **not modified**. 17.1 built it for this (`stat-card.tsx:19`: "`tone="alert"` is opt-in only -- Story 17.2's 'At risk' card, when non-zero"). Every link works for every role that sees the row: all three roles have the `/subscriptions`, `/members` and `/classes` sidebar items (`Sidebar.tsx:37-48`).

3. **Every figure is a COUNT, never a row fetch.** Each of the four uses `.select(<col>, { count: "exact", head: true })`, the pattern `memberCountForGym()` uses at `members.ts:307-313`. `supabase/config.toml:18`'s `max_rows = 1000` truncates row fetches silently but does not affect `count`, and `head: true` transfers no rows. Never count `data.length`, and never sum client-side (FR-143: "no figure may be computed by a client-side sum over fetched rows").

4. **Active members = `subscriptions_current` rows with `status in ('active','expiring_soon')` and `deactivated_at is null`**, scoped `.eq("gym_id", gymId)`.
   - **Why both statuses (decided):** `0027_member_app_check_in_result_states.sql:22-24` lets `expiring_soon` and `grace_period` members check in. Counting `active` alone would drop the card by exactly row 1's "Expiring this week" figure every week. With both statuses, Active + At risk covers every non-deactivated member's current subscription, and "Expiring this week" is a subset of Active.
   - **Mandatory:** do **not** use `memberCountForGym()`, which counts every `role = 'member'` row including deactivated and expired members.
   - **The deactivated filter is the trap:** `subscriptions_current` (`0037:35-56`) does **not** exclude deactivated members. It exposes `m.deactivated_at` as a column, and `listSubscriptions()` adds `.is("deactivated_at", null)` itself (`subscriptions.ts:323`). `subscriptions.ts:296-297`'s comment says "The view already excludes deactivated members' rows"; that phrasing is misleading, since the service does it. Skip the filter and a deactivated member with a live subscription is counted.

5. **At risk = the same view, `status in ('grace_period','expired')` and `deactivated_at is null`.** It passes `tone="alert"` **only** when the count loaded successfully **and** is `> 0`. A zero count, or a failed read showing `overview.cards.unavailable`, renders in the default tone: a healthy gym must not see a red number, and "Unavailable" is not an alert.

6. **Named status filters on `/subscriptions` (decided).** `services/subscriptions.ts` gains a status-group map:

   ```ts
   const SUBSCRIPTION_STATUS_GROUPS = {
     active_or_expiring: ["active", "expiring_soon"],
     at_risk: ["grace_period", "expired"],
   } satisfies Record<string, SubscriptionListRow["status"][]>;
   ```

   `applySubscriptionFilters` (`subscriptions.ts:283-293`) applies `.in("status", group)` for a group key, `.eq("status", s)` for one of the four real statuses, and nothing for any other value. That last case is today's silent-ignore behaviour, unchanged; add `in` to its local `ChainableFilter` type.
   - Because `listSubscriptions()` (`:302-343`) and `exportSubscriptionsCsv()` (`:365-400`, filter applied at `:381`) both go through that one function, both groups work on the page and in the CSV export with no further change.
   - `subscriptions/page.tsx:37-80` already passes `params.status` through untouched, and `subscriptions/actions.ts:55` takes `status?: string` with no enum. Neither changes.
   - `SubscriptionsPageClient.tsx:17-24`'s `STATUS_OPTIONS` / `STATUS_LABEL_KEY` gain the two keys after the four single statuses, so `?status=at_risk` echoes into the `<select>` (`:198-210`) as a real option rather than a blank.
   - The row-2 cards count through a new `countSubscriptions()` that calls the **same** `applySubscriptionFilters` on the **same** base query (view, `gym_id`, `deactivated_at is null`). A card's `href` and its count call use the **same** key constant, so the card and its target share one predicate and cannot drift, which is 17.1 AC #3's principle.
   - Single-status behaviour is byte-for-byte unchanged, including 17.1's `listSubscriptions({ status: "expiring_soon", sort: "expiry" })` (`page.tsx:111`).

7. **New this month = `members` rows with `role = 'member'` and `join_date` in `[month_start_date, next_month_start_date)`**, gym-local, scoped `.eq("gym_id", gymId)`.
   - **Why `join_date` (decided):** it is the business join date. CSV import writes it straight from the file (`csvImport.ts:171,181,422`), and the Add Member form defaults it to today (`MemberModal.tsx:107`). `created_at` (`0003:29`) is insert time, so a gym that imports its roster in its first month, which every onboarding gym does, would see the whole roster as "new".
   - **`join_date` is a `date`** (`0003:26`), so the bounds are compared as `YYYY-MM-DD` strings, never as timestamps.
   - **`.eq("role", "member")` is load-bearing:** `gym_staff_read_own_members` returns staff rows too. Measured: 3 new members, 8 without the role filter, because the 5 staff fixtures all joined this month.
   - **Deactivated members are NOT excluded:** this card counts joins (a flow), not current headcount, and its target `/members` with no filter lists deactivated members too. If a reviewer disagrees, it is a one-line `.is("deactivated_at", null)`. Do not add it silently.

8. **Today's classes = `class_sessions` with `scheduled_at` in `[day_start, next_day_start)`**, gym-local, scoped `.eq("gym_id", gymId)`. It counts every session scheduled for today, including ones already finished. There is no cancellation column on `class_sessions` (`0057:72-78`), and a reschedule deletes future sessions outright (`0093:475`), so every row is a real session.

9. **Migration `supabase/migrations/0097_gym_local_period_bounds.sql`** adds exactly two functions plus their grants and a verify block, using **this SQL exactly**. It was compiled and exercised against this repo's local Supabase during story creation; see Dev Notes → *Measured*.

   ```sql
   create function private.gym_local_day_bounds(p_timezone text, p_at timestamptz)
   returns table (day_start timestamptz, next_day_start timestamptz)
   language sql
   immutable
   set search_path = public, pg_temp
   as $$
     select
       date_trunc('day', p_at at time zone p_timezone) at time zone p_timezone,
       (date_trunc('day', p_at at time zone p_timezone) + interval '1 day') at time zone p_timezone;
   $$;

   revoke execute on function private.gym_local_day_bounds from public;
   grant execute on function private.gym_local_day_bounds to authenticated;

   create function gym_local_period_bounds()
   returns table (month_start_date date, next_month_start_date date, day_start timestamptz, next_day_start timestamptz)
   language sql
   stable
   set search_path = public, pg_temp
   as $$
     select
       (m.month_start at time zone g.timezone)::date,
       (m.next_month_start at time zone g.timezone)::date,
       d.day_start,
       d.next_day_start
     from gyms g,
          private.gym_local_month_bounds(g.timezone, now()) m,
          private.gym_local_day_bounds(g.timezone, now()) d
     where g.id = private.gym_id();
   $$;

   revoke execute on function gym_local_period_bounds from public;
   grant execute on function gym_local_period_bounds to authenticated;
   ```

   - **Invoker rights on both functions, no `security definer` anywhere.** `gyms` is read under `"read own gym"` (`id = private.gym_id()`, no role predicate), and neither function reads a gated table.
   - **No suspension guard, and not in `suspension_rpc_coverage.test.sql`:** no gated data is returned, and that meta-test audits DEFINER functions that write. A suspended gym still gets its bounds; its counts come back 0 through `tenant_active_gate`.
   - **Reuse, don't copy:** month bounds come from 0095's `private.gym_local_month_bounds()` (`0095:87-101`), per 0095's own header mandate (`0095:56-58`). Do not inline or copy that arithmetic.
   - **Same `+ interval` rule as 0095:** it is added to the gym-local `timestamp` inside `date_trunc(...)`, then converted back. Placed after the `at time zone` round-trip it runs in the session timezone and is wrong on DST days.
   - **Shape:** `create function`, not `create or replace`, and no `begin;`/`commit;`.
   - **Header comment**, house style as in `0095:1-82`: what this closes (PostgREST exposes only `public`/`graphql_public`, `config.toml:13`, so a COUNT query cannot reach the private helper), why invoker rights, why the month helper is reused, why the `+ interval` placement matters for the day helper, why dates for the month and instants for the day, and that zero rows means no visible `gyms` row.
   - **Trailing verify block**, messages prefixed `'0097: '`, asserting:
     - (a) `gym_local_period_bounds()` exists with 0 args;
     - (b) neither function grants EXECUTE to PUBLIC, where a NULL `proacl` counts as granted (copy `0095:145-156`);
     - (c) neither is `prosecdef`;
     - (d) `private.gym_local_day_bounds('Europe/Paris', '2026-03-29 12:00+00')` is `[2026-03-28 23:00+00, 2026-03-29 22:00+00)`, a 23-hour DST day.

     That block was run as part of the proof. It passes, and the wrong form yields `2026-03-29 23:00+00` there.
   - **Numbered 0097, not 0096.** 0096 is reserved for Story 17.4's roster RPC (`epics.md` Epic 17 table). Do not renumber if 17.2 lands first; a temporary gap is harmless.
   - **0097 depends on 0095** (it calls `private.gym_local_month_bounds`), so it must apply after it.

10. **`getGymLocalPeriodBounds()` in `services/gym-settings.ts`.** It is a no-arg `supabase.rpc("gym_local_period_bounds")` with no gym id passed; `private.gym_id()` resolves the gym server-side. It maps the first row to `{ monthStartDate, nextMonthStartDate, dayStart, nextDayStart }`.
    - **Zero rows** (no `gym_id` claim, or no visible gym) → `{ data: null, error: await gymNotFoundError("gym_local_period_bounds returned no row") }`, using that file's existing helper.
    - **RPC error** → `{ data: null, error: await mapAndLog(error) }`.
    - Do **not** use `.single()`. No `.rpc(...).single()` precedent exists in this app, and the explicit zero-row branch keeps the not-found path under this file's own logging.
    - Row 2 calls it **once** per render, and both date-bounded cards use that one result.

11. **Row 2 streams in its own `<Suspense>`** at 17.1's seam (`page.tsx:168-170`). The fallback is a 4-card skeleton, and the boundary sits between the row-1 card grid and `CheckedInTable`.
    - **Structure:** an async Server Component `GymHealthRow` rendered inside `OverviewData`'s returned JSX, wrapped in `<Suspense fallback={<GymHealthRowSkeleton />}>`. Row-1 cards and both tables never wait for row 2.
    - **Accepted trade-off:** row 2's reads start only once `OverviewData`'s own `Promise.all` has resolved, a small waterfall behind row 1. The AC protects row 1 from row 2, not the reverse; do not restructure `OverviewGate` to pre-start row 2's promise.
    - **Inner skeleton:** `OverviewSkeleton` (`page.tsx:189-210`, the inner boundary only staff reach) renders `GymHealthRowSkeleton` after its 3-card grid **only** when the gate passes, so manager-plus users see no layout jump and a Receptionist never sees a 4-card shape.
    - **Outer skeleton unchanged:** `OverviewGateSkeleton` (`page.tsx:217-224`) stays exactly as it is. The role is unknown there, and Story 17.3 made it role-neutral on purpose.
    - **Shared definition:** one `GymHealthRowSkeleton` is used by both, so the heights match. Use the same tile skeleton as row 1 (`h-[86px] w-full animate-pulse rounded-md bg-muted`), text-free.

12. **Per-card failure isolation.** Every service returns `{ data, error }` and never throws (AD-9), so no single failure can reject the row. Branch on each result independently:
    - a failed Active or At-risk count shows `overview.cards.unavailable` on that card only;
    - a failed bounds RPC shows `unavailable` on **exactly** New this month and Today's classes, and their two count calls are **not attempted**;
    - a failed count degrades only its own card.

    Log each failure once with `console.error`, the `OverviewData: <fn> failed -- <message>` shape of `page.tsx:115-123`, using a `GymHealthRow:` prefix. Row 2 failing entirely never affects row 1 or the tables.

13. **Explicit-locale formatting.** Every value is `count.toLocaleString(locale)`, where `locale` comes from the `getRequestLocale()` result `OverviewData` already holds (`page.tsx:92`), passed to `GymHealthRow` as a prop. Never call bare `toLocaleString()`; `PaymentsPageClient.tsx` documents that as a shipped bug.

14. **i18n.** `apps/dashboard/locales/en.json` and `fr.json` both gain the keys below, and `node scripts/check-i18n-key-parity.mjs` passes. Reuse the existing `overview.cards.unavailable`. French wording matches the shipped `members.status.*` values (Actif / Expire bientôt / Délai de grâce / Expiré).

    | Key | EN | FR |
    |---|---|---|
    | `overview.cards.activeMembers` | Active members | Membres actifs |
    | `overview.cards.newThisMonth` | New this month | Nouveaux ce mois-ci |
    | `overview.cards.todaysClasses` | Today's classes | Cours du jour |
    | `overview.cards.atRisk` | At risk | À risque |
    | `subscriptions.statusGroups.activeOrExpiring` | Active or expiring soon | Actif ou expire bientôt |
    | `subscriptions.statusGroups.atRisk` | At risk (grace period or expired) | À risque (délai de grâce ou expiré) |

15. **Types.** `packages/types/src/database.ts` gains, alphabetically between `gym_effective_member_cap` (`:2046`) and `gym_member_count` (`:2047`):

    ```ts
    gym_local_period_bounds: {
      Args: never
      Returns: {
        day_start: string
        month_start_date: string
        next_day_start: string
        next_month_start_date: string
      }[]
    }
    ```

    This follows `apply_saas_billing_credit`'s set-returning shape (`:1787-1791`). Prefer `supabase gen types typescript --local`, but in this devcontainer it exits 0 and writes 0 bytes (Story 17.1 Debug Log). Hand-add the entry and say so in Completion Notes. Do not commit CLI-version churn to the other entries.

16. **pgTAP** in a new `supabase/tests/gym_local_period_bounds.test.sql`, in `gym_revenue_mtd.test.sql`'s style: `begin;` / `select plan(N);` / `finish()` / `rollback;`, its own story-scoped UUID block (e.g. `00000000-0000-0000-0172-…`), and every assertion scoped to its own fixtures. It must prove:
    - **Shape and privileges, both functions:** `has_function`, `isnt_definer`, `volatility_is` (`immutable` for the day helper, `stable` for the wrapper), `anon` cannot execute, `authenticated` can. Also assert `pg_get_functiondef('public.gym_local_period_bounds()')` references both `private.gym_local_month_bounds(` and `private.gym_local_day_bounds(`, so the fixed-date proofs cover the live wrapper.
    - **Day helper at fixed dates, against a `make_timestamptz()` oracle:** every day of 2026 × three instants (local 00:00, 12:00, 23:59) × the five allowed zones (`Africa/Douala`, `Africa/Lagos`, `Africa/Bangui`, `Africa/Kinshasa`, `UTC`, the same list as `gym_revenue_mtd.test.sql:70`). Zero mismatches under `set local timezone = 'UTC'` **and** under `'Pacific/Kiritimati'` (UTC+14).
    - **Positive control for the day helper:** in `Europe/Paris` the wrong form (`+ interval '1 day'` after the round-trip) differs from the oracle on exactly two days, 2026-03-29 and 2026-10-25, while the helper matches on both. No allowed zone has DST, so without this control the oracle could not tell right from wrong.
    - **Wrapper composition:** under Gym A owner claims it returns exactly one row. That row's two dates equal `private.gym_local_month_bounds(tz, now())` converted with `at time zone tz` then `::date`, and its instants equal `private.gym_local_day_bounds(tz, now())`. With no `gym_id` claim it returns **zero** rows, and for a suspended gym's owner it still returns one row.
    - **The four count predicates under RLS**, using exactly the filters the services send, fixtures incremental with a positive control before each exclusion. For owner, manager, supervisor **and** receptionist the figures are **Active 3 / At risk 2 / New this month 3 / Today's classes 2** on the fixture set in Dev Notes → *Measured*. The same file must also show:
      - the `role = 'member'` filter is necessary (8 without it);
      - a renewed member with an old `grace_period` row and a newer `active` row counts once, as Active;
      - a deactivated member with an `active` subscription is excluded from Active but included in New this month;
      - Gym B's rows are excluded;
      - a suspended gym's owner gets 0 for the three gated counts.
    - **Role-switching:** `set local role authenticated;` + `select set_config('request.jwt.claims', '{"sub":…,"role":"authenticated","gym_id":…,"app_role":…}', true);` then `reset role;`, as in `refund_recording.test.sql`. `gym_staff_read_own_members` resolves the role live through `private.current_member_role()`, so each caller's `sub` needs a real `members` row in that gym.
    - **Fixture traps:**
      - seed a suspended gym with `status = 'suspended'` **in its INSERT**, never by UPDATE, because a trigger (`0014:33,51`) silently reverts that;
      - give **every** fixture member an explicit `join_date`, staff included: the column defaults to UTC `current_date`, which on the gym-local 1st of a month before 01:00 is still the previous month;
      - seed session times relative to the wrapper's own `day_start`/`next_day_start`. `now()` is fixed for the whole transaction, so relative fixtures cannot straddle midnight.

17. **Vitest.** `globals` is **not** enabled: import `describe`/`it`/`expect`/`vi` from `vitest` explicitly.
    - `app/(dashboard)/components/GymHealthRow.test.tsx`: await `GymHealthRow({ locale })` directly, as in `page.overview.test.tsx:121-130`, with services mocked. Assert:
      - the four `StatCard`s' order, labels, values and hrefs;
      - `countSubscriptions` is called with exactly `"active_or_expiring"` and `"at_risk"`;
      - `countMembersJoinedBetween` gets `monthStartDate`/`nextMonthStartDate` and `countClassSessionsBetween` gets `dayStart`/`nextDayStart`;
      - every service is called once;
      - FR number formatting: `(1200).toLocaleString("fr")`;
      - At risk tone is `"alert"` only when `> 0` and loaded, and default for `0` and on failure;
      - each isolation case from AC #12, including: bounds failure → the two dependent cards are unavailable **and** the two dependent count functions were never called.
    - `page.overview.test.tsx`, extended:
      - owner, manager and supervisor shells each get exactly one `GymHealthRow` element whose parent is a `Suspense` with a `GymHealthRowSkeleton` fallback, placed after the row-1 grid and before `CheckedInTable`;
      - a receptionist shell gets **zero** `GymHealthRow` elements and no `GymHealthRowSkeleton` in the inner `OverviewSkeleton` fallback; the owner shell gets exactly one there;
      - mock `./components/GymHealthRow` (both exports) so this file never imports the new services.

      The existing "renders the three AD-02 cards, in order" `toEqual` (`:172-180`) must keep passing **unchanged**: row 2's cards live inside an unawaited async component, and `findAll` does not descend into it. If that test starts seeing seven cards, row 2 was inlined rather than streamed, and that is the bug.
    - `page.coachRedirect.test.tsx`: add the same `./components/GymHealthRow` mock. Its four existing tests (`:109`, `:116`, `:125`, `:154`) must stay green unchanged.
    - One service test file per new function, mocking `@/lib/supabase/server` as `payments.getRevenueMtd.test.ts:14-31` does. For the `from()`-chain counts, follow an existing chain mock such as `members.getMemberForInvite.test.ts`. Assert `{ count: "exact", head: true }`, the exact `.eq` / `.is` / `.in` / `.gte` / `.lt` calls, `count` returned on success, and a mapped error with `data: null` and no throw:
      - `subscriptions.countSubscriptions.test.ts`, which also covers `listSubscriptions({ status: "at_risk" })` using `.in` while `"grace_period"` still uses `.eq`;
      - `members.countMembersJoinedBetween.test.ts`;
      - `classes.countClassSessionsBetween.test.ts`;
      - `gym-settings.getGymLocalPeriodBounds.test.ts`: no-arg call, snake→camel mapping, `[]` → `not_found`, error → mapped.

18. **Regressions held.** All of 17.1's and 17.3's tests pass unchanged apart from the two added mocks above. `FrontDeskAlertPanel`, `OverviewAutoRefresh`, `CheckedInTable`, `ExpiringTable`, `stat-card.tsx`, `Sidebar.tsx`, `OverviewGate` and `OverviewGateSkeleton` are unmodified. `pnpm --filter @gymos/dashboard build` exits 0; treat it as a general gate only, not as proof the boundary is right (see Dev Notes).

19. **Record-keeping, in the same change.**
    - A `docs/decisions.md` entry dated 2026-09-10, "recorded during Story 17.2", at the **top** (the file is newest-first). It covers the four product-owner decisions and one fact: gym-local bounds for COUNT queries needed a public wrapper because PostgREST exposes only `public`.
    - A `deferred-work.md` entry for the pre-existing `/members?status=` mismatch in Dev Notes, found during this story's creation and not fixed here.

    Cite `decisions.md` by dated heading, never by line number. `epics.md` and `EXPERIENCE.md` are **already amended**; do not amend them again.

## Tasks / Subtasks

- [ ] **Task 0: branch hygiene (before any code)**
  - [ ] Story 17.3 is `done`, but its work is **uncommitted** on `feat/17-3-coach-portal-nav`, and this story edits the post-17.3 `page.tsx` (its two-boundary `OverviewGate` split). Confirm 17.3 has been committed, PR'd and merged to `master`, then branch `feat/17-2-gym-health-cards` from that `master`. Record that commit as `baseline_commit`. Do **not** stack 17.2 onto 17.3's uncommitted working tree, or both stories' diffs become unreviewable.

- [ ] **Task 1: migration 0097 (AC: #9)**
  - [ ] Create `supabase/migrations/0097_gym_local_period_bounds.sql` with AC #9's exact SQL, the header comment, and the verify block
  - [ ] Apply locally over host psql, one transaction, `ON_ERROR_STOP`: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0097_gym_local_period_bounds.sql`. As for 0092–0095 locally, insert no ledger row, and say so in the Debug Log
  - [ ] Check `pg_proc`: `prosecdef = f` for both; `provolatile` `i` for the helper and `s` for the wrapper; `proacl = {postgres=X/postgres,authenticated=X/postgres}` for both

- [ ] **Task 2: types (AC: #15)**
  - [ ] Add `gym_local_period_bounds` to `packages/types/src/database.ts`; record whether it was generated or hand-added

- [ ] **Task 3: services (AC: #3–#8, #10)**
  - [ ] `services/gym-settings.ts`: `export interface GymLocalPeriodBounds` + `getGymLocalPeriodBounds()` per AC #10
  - [ ] `services/subscriptions.ts`: `SUBSCRIPTION_STATUS_GROUPS`; extend `applySubscriptionFilters` + `ChainableFilter`; export `type SubscriptionStatusFilter = SubscriptionListRow["status"] | keyof typeof SUBSCRIPTION_STATUS_GROUPS`, typing the map with `satisfies` so its keys stay literal; add `countSubscriptions(params: { status: SubscriptionStatusFilter })` built on the same base query as `listSubscriptions` (`subscriptions_current`, `.eq("gym_id", gymId)`, `.is("deactivated_at", null)`) + `applySubscriptionFilters`, with `.select("subscription_id", { count: "exact", head: true })`. Fix the misleading "view already excludes deactivated" wording at `:296-297` while there
  - [ ] `services/members.ts`: `countMembersJoinedBetween(startDate: string, endDateExclusive: string)`, i.e. `from("members").select("id", { count: "exact", head: true }).eq("gym_id", gymId).eq("role", "member").gte("join_date", startDate).lt("join_date", endDateExclusive)`
  - [ ] `services/classes.ts`: `countClassSessionsBetween(startIso: string, endIsoExclusive: string)`, i.e. `from("class_sessions").select("id", { count: "exact", head: true }).eq("gym_id", gymId).gte("scheduled_at", startIso).lt("scheduled_at", endIsoExclusive)`
  - [ ] Each count uses its own file's `getCallerGymId()` (the per-file-copy convention: `classes.ts:24-43` explains it) and returns `{ data: number | null; error: AppError | null }`, with `count ?? 0` on success only

- [ ] **Task 4: `GymHealthRow` (AC: #2, #4, #5, #7, #8, #11, #12, #13)**
  - [ ] Create `app/(dashboard)/components/GymHealthRow.tsx`: an async Server Component, **no** `"use client"`, props `{ locale }` typed as `getServerTranslation` accepts. Export `GymHealthRow` and `GymHealthRowSkeleton`
  - [ ] Declare the two group keys once as constants and use each in **both** the `countSubscriptions` call and its card `href`
  - [ ] Start all reads as early as possible: the two `countSubscriptions` calls and `getGymLocalPeriodBounds()` together, and the two date-bounded counts in parallel as soon as the bounds resolve (e.g. a `.then` on the bounds promise inside one `Promise.all`), not serially after the subscription counts
  - [ ] Grid `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`, the same responsive family as row 1's `sm:grid-cols-3`
  - [ ] At risk: `tone={atRiskLoaded && atRisk > 0 ? "alert" : "default"}`

- [ ] **Task 5: wire into `page.tsx` (AC: #1, #11)**
  - [ ] One gate helper, e.g. `const GYM_HEALTH_ROLES: readonly MemberRole[] = ["manager", "supervisor", "owner"]` + `canSeeGymHealth(shell)`; `null` shell → `false`. `MemberRole` is exported from `services/session.ts:37`
  - [ ] `OverviewGate`: pass `showGymHealth={canSeeGymHealth(shell)}` to `OverviewSkeleton`. Leave the redirect, its position, and `OverviewGateSkeleton` untouched
  - [ ] `OverviewData`: replace the 17.1 seam comment (`:168-170`) with `{canSeeGymHealth(shell) && <Suspense fallback={<GymHealthRowSkeleton />}><GymHealthRow locale={locale} /></Suspense>}`, and add nothing to its existing `Promise.all`
  - [ ] Update the file's header comment (`:23-61`) to mention row 2, its gate, and its own boundary

- [ ] **Task 6: `/subscriptions` named filters (AC: #6)**
  - [ ] `SubscriptionsPageClient.tsx`: add `active_or_expiring` and `at_risk` to `STATUS_OPTIONS` (after `expired`) and to `STATUS_LABEL_KEY` → `subscriptions.statusGroups.*`
  - [ ] Confirm by reading, and by hand in the browser pass, that `/subscriptions?status=at_risk` selects the option, lists only grace/expired rows, and exports only those; `/subscriptions?status=bogus` still lists everything, as today

- [ ] **Task 7: i18n (AC: #14)**
  - [ ] Add the six keys to `en.json` + `fr.json`; `node scripts/check-i18n-key-parity.mjs` → clean. The `i18next/no-literal-string` gate is `jsx-text-only` (`eslint.config.mjs:22-38`), so a hardcoded `aria-label` passes CI silently; still, don't write one

- [ ] **Task 8: tests (AC: #16, #17)**
  - [ ] `supabase/tests/gym_local_period_bounds.test.sql`, run over host psql with `set search_path = public, extensions;` prepended (`supabase test db` is not runnable here; Story 17.1 Debug Log), then the **full** suite, not just the new file
  - [ ] The Vitest files listed in AC #17, red before green where practical

- [ ] **Task 9: record-keeping (AC: #19)**
  - [ ] `docs/decisions.md` top entry; `deferred-work.md` entry

- [ ] **Task 10: verify (AC: all)**
  - [ ] `pnpm --filter @gymos/dashboard typecheck`, `lint` (0 errors; no new warnings in touched files), `test`
  - [ ] `pnpm --filter @gymos/dashboard build` exit 0
  - [ ] `node scripts/check-i18n-key-parity.mjs` clean
  - [ ] Full pgTAP suite green over host psql
  - [ ] Leave for smartsana's manual browser pass (they do browser QA themselves; list it in Completion Notes rather than attempting it): owner/supervisor/manager see 7 cards; receptionist sees 3 with no row-2 flash while loading; At risk red only when non-zero; each card's link lands on a page whose count matches (`?status=active_or_expiring` and `?status=at_risk` totals = the card figures); EN/FR

## Dev Notes

- **Read `apps/dashboard/AGENTS.md` first.** Next.js here is **16.3.4** (`package.json` says `"latest"`; the installed version is what counts), with breaking changes against training data. Check `apps/dashboard/node_modules/next/dist/docs/` before touching routing or Suspense behaviour. Relevant facts already established by 17.1/17.3: `cacheComponents: true` (`next.config.ts:9`) requires every cookie-backed read inside an explicit `<Suspense>`; `middleware.ts` is `proxy.ts`; `searchParams` is a Promise.

- **The build will not catch a missing row-2 boundary.** `(dashboard)/layout.tsx:17` already wraps children in `<Suspense fallback={null}>`, and this page has two boundaries of its own above the seam. If `GymHealthRow` is rendered without its own `<Suspense>`, it suspends to `OverviewSkeleton`: row 1 then waits for row 2, the exact thing AC #11 forbids, and the build still exits 0. The guard is AC #17's "parent is a `Suspense` with a `GymHealthRowSkeleton` fallback" assertion. Do not rely on the build.

- **Why a migration at all (decided).** The obvious no-migration route is `.gte("join_date", …)` with bounds computed in TypeScript from `gyms.timezone` via `Intl`. It was rejected for three reasons:
  - it would be the app's first gym-local date arithmetic in TS; there is no date/tz library in `apps/dashboard/package.json`, and `services/attendance.ts:44-53` still documents UTC-only bounds as the accepted gap;
  - it bypasses 0095's helper, which 0095's header requires 17.2 to reuse (`0095:56-58`), and which exists because the `+ interval` placement bug is invisible in 7 months of 12;
  - "Today's classes" needs **instants** (`scheduled_at` is `timestamptz`), which is the error-prone half.

  The helper cannot be called from PostgREST directly: `supabase/config.toml:13` exposes `["public", "graphql_public"]` only. So 0097 is a public, invoker-rights, read-only wrapper, and the COUNT queries stay plain PostgREST head counts as AC #3 requires.

- **Why dates for the month and instants for the day.** `members.join_date` is `date`, so it compares against gym-local `YYYY-MM-DD` strings with no offset arithmetic anywhere in TS. `class_sessions.scheduled_at` is `timestamptz`, so it compares against UTC instants. The wrapper derives the month dates from the month helper's instants (`at time zone tz` then `::date`), so "New this month" covers exactly the same period as 17.1's "Revenue this month". Do not re-derive them with a separate `date_trunc('month', …)::date`.

- **Measured (local Supabase, rolled-back transaction, during story creation).**
  - **Functions:** `pg_proc` has `gym_local_day_bounds` `prosecdef=f provolatile=i`, `gym_local_period_bounds` `prosecdef=f provolatile=s`, both `proacl={postgres=X/postgres,authenticated=X/postgres}`, and `anon` has no EXECUTE on either.
  - **Day-helper oracle:** 6,570 rows (every 2026 day × 3 instants × 5 allowed zones + Europe/Paris) with **0 mismatches** under a UTC session and **0** under UTC+14. The wrong form is wrong on exactly Europe/Paris 2026-03-29 and 2026-10-25. Spot values: Douala `2026-03-15 23:30+00` → `[2026-03-15 23:00, 2026-03-16 23:00)`; `22:59+00` → `[2026-03-14 23:00, 2026-03-15 23:00)`.
  - **Wrapper at now = 2026-09-10 11:49 UTC:** `2026-09-01 / 2026-10-01 / 2026-09-09 23:00+00 / 2026-09-10 23:00+00`.
  - **Fixtures, Gym A Douala:**
    - staff owner, manager, supervisor, receptionist and coach, all joined this month;
    - m1 joined on the local 1st, `active`;
    - m2 joined on the last local day of the month, `expiring_soon`;
    - m3 joined on the last day of the prior month, `grace_period`;
    - m4 joined on the 1st of next month, `expired`;
    - m5 is deactivated, joined this month, `active`;
    - m6 joined in 2025 and was renewed, with an older `grace_period` row and a newer `active` row;
    - four class sessions at `day_start`, `next_day_start − 1 min`, `day_start − 1 min` and `next_day_start`;
    - plus a Gym B member and session today, and a suspended Gym C.
  - **Results:**

    | Caller | Active | At risk | New this month | New, no role filter | Today's classes | Bounds rows |
    |---|---|---|---|---|---|---|
    | owner, manager, supervisor, receptionist | 3 | 2 | 3 | 8 | 2 | 1 |
    | coach | 0 | 0 | 0 | 1 (own row via `self_read_own_membership`) | 2 (`class_sessions` has no role check) | 1 |
    | Gym C (suspended) owner | 0 | 0 | 0 | 0 | 0 | 1 |
    | session with no `gym_id` claim | — | — | — | — | — | 0 |

  **If your pgTAP results differ from these, the difference is the bug.**

- **Live RLS, not migration text.** `gym_staff_read_own_members` as it exists today (from `pg_policies`, not `0018:167`'s original text) is `gym_id = private.gym_id() AND private.current_gym_status() = 'active' AND private.current_member_role() = ANY('{owner,manager,receptionist,supervisor}')`. The role comes from a live DB lookup, not the JWT, and Coach is gone (0040). `gym_staff_read_own_subscriptions` (post-`0093:122`) grants owner/manager/supervisor/receptionist plus a member's own rows. `gym_staff_read_own_class_sessions` (`0057:172-174`) has **no role predicate**. All three tables carry `tenant_active_gate` (`0073:117,129,159`). Supervisor can read all of it, so no widening is needed. Do not cite `0018`'s role arrays as current.

- **Pre-existing mismatch to record, not fix: `/members?status=` vs the current subscription.** `listMembers()` filters with `subscriptions!inner(...)` + `.eq("subscriptions.status", s)` + `.limit(1, { referencedTable })` (`members.ts:172-178,205-219`). PostgREST applies an embedded filter before the embedded limit, so a member matches if **any** of their subscription rows has that status. `members.ts:186-189` claims "a member here always has at most one subscription row", but `confirm_renewal()` inserts a new row and leaves the old one alone (`0093:335-371`), and the nightly job moves old rows through `grace_period` to `expired` (`0021:60-86`). A just-renewed member can therefore appear under `/members?status=grace_period`. That is why decision (4) routes both status cards to `/subscriptions`, which reads `subscriptions_current` (latest row per member, `0037:38,56`). The local DB currently has no multi-subscription member, so this comes from reading the code, not from a measurement; say so in the `deferred-work.md` entry.

- **What a Receptionist's hidden row does and does not mean.** The row is hidden for product reasons (EXPERIENCE.md AD-02 V2: "management information, not front-desk information"). A Receptionist can still open `/subscriptions?status=at_risk` by URL and get the same figure, under this app's documented "Sidebar hides it, RLS is the real gate" precedent (`subscriptions/page.tsx:16-31`). Do not "fix" that here; no AC asks for it, and the epic changes no policy.

- **Polling cost, accepted.** 17.1's `OverviewAutoRefresh` calls `router.refresh()` every 60 s on visible tabs, which re-runs the whole server tree, row 2 included. That adds one RPC plus four head counts (and each service's claims read) per minute per visible manager-plus tab. They are small indexed counts, and the tick already skips hidden tabs and open dialogs. Do not add a separate cache or a second refresh mechanism, and do not touch `OverviewAutoRefresh.tsx`. `router.refresh()` does not re-show Suspense fallbacks for already-rendered content, so row 2 does not flash on each tick.

- **`join_date` caveats, accepted.** The Add Member form defaults it to the browser's local date (`MemberModal.tsx:107`), CSV rows carry whatever the file says, and a DB-side default would be UTC `current_date` (`0003:26`). It is a business date, which is the point, not a precise instant. A future-dated `join_date` counts in its own month, not this one.

- **Do not reuse or modify these:**
  - `memberCountForGym()`: it counts deactivated and expired members (AC #4);
  - `listClasses()`: it fetches rows and counts in JS (`classes.ts:149-155,168-193`), which is exactly what AC #3 forbids for a figure;
  - `getGymSettings()`: row 2 needs the bounds, not the timezone string;
  - `gym_member_count` RPC: an owner-cap helper with a `p_gym_id` arg.

- **Deploy.** Production is at `0094`, and `0095` is merged but **not deployed**. `0096` (Story 17.4) ships in the same release (the product owner's 2026-09-10 decision, `epics.md` Epic 17 dependency paragraph), and `0097` now joins them: **one batch, applied in order 0095 → 0096 → 0097.** Deploy over host `psql`, never `supabase db push`, because the CLI's container path fails silently in this devcontainer. Copy `scripts/deploy-0090-0094.sh`'s shape: each migration in its own transaction with `ON_ERROR_STOP`, and its `supabase_migrations.schema_migrations` row inserted in that same transaction. Writing that script is **not** this story's job; do not deploy.

- **Testing stack.** Vitest 4.1.10 + `@testing-library/react` 16.3.2 (jsdom, co-located `*.test.ts(x)`, `globals` off). pgTAP lives in `supabase/tests/`. Async Server Components are tested by awaiting the component function, as in `layout.gymSwitchRemount.test.tsx` and `page.overview.test.tsx:116-130`; no renderer is needed.

- **Out of scope:** any change to row 1, the alert panel, the tables, `StatCard`, the Sidebar, the gate skeleton, the coach redirect, `/members` filtering, `/classes` (no date param added; it lists classes, not today's sessions, which is accepted), every RLS policy, and a production deploy.

### Project Structure Notes

- **New:** `supabase/migrations/0097_gym_local_period_bounds.sql`, `supabase/tests/gym_local_period_bounds.test.sql`, `apps/dashboard/app/(dashboard)/components/GymHealthRow.tsx` + `GymHealthRow.test.tsx`, `apps/dashboard/services/subscriptions.countSubscriptions.test.ts`, `services/members.countMembersJoinedBetween.test.ts`, `services/classes.countClassSessionsBetween.test.ts`, `services/gym-settings.getGymLocalPeriodBounds.test.ts`.
- **Modified:** `apps/dashboard/app/(dashboard)/page.tsx`, `page.overview.test.tsx`, `page.coachRedirect.test.tsx` (mock only), `services/subscriptions.ts`, `services/members.ts`, `services/classes.ts`, `services/gym-settings.ts`, `app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx`, `locales/en.json`, `locales/fr.json`, `packages/types/src/database.ts`, `docs/decisions.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`, this story file.
- **Explicitly unmodified:** `components/ui/stat-card.tsx`, `components/shared/Sidebar.tsx`, `components/shared/FrontDeskAlertPanel.tsx`, `app/(dashboard)/components/{CheckedInTable,ExpiringTable,OverviewAutoRefresh}.tsx`, `app/(dashboard)/layout.tsx`, `subscriptions/page.tsx`, `subscriptions/actions.ts`, `supabase/migrations/0095_gym_revenue_mtd.sql`, `supabase/tests/suspension_rpc_coverage.test.sql`, every RLS policy. `app/(dashboard)/loading.tsx` must still **not** exist (17.1 AC #13).
- The per-route `components/` folder under the route-group root was established by 17.1, and `GymHealthRow` joins it. The services follow AD-7 (`services/<domain>.ts`): the subscription count in subscriptions, the member count in members, the class count in classes, and gym-calendar bounds beside the other `gyms` reads in gym-settings. Money/units are not involved, and AD-9's `{ data, error }` holds throughout.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 17.2: Staff Overview — Gym Health Cards (Manager-plus) — including the 2026-09-10 amendment note]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 17 — story table (17.2 → 0097), dependency order, scope boundary (zero RLS policies)]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-09.md — Finding 1 (COUNT vs max_rows), §2 Story impact, §5 success criterion 2]
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:553 — FR-143]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:1085-1096 — AD-02 V2 amendment (as amended 2026-09-10); :211 — "Manager-plus"]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md — AD-1, AD-7, AD-9]
- [Source: _bmad-output/implementation-artifacts/17-1-staff-overview-operational-cards-live-tables.md — AC #13, #15, #16; Review Findings (month helper mandate); Debug Log (host psql, gen types, pgTAP method)]
- [Source: _bmad-output/implementation-artifacts/17-3-coach-portal-sub-navigation-landing.md — AC #1, #2; Completion Notes (two boundaries)]
- [Source: apps/dashboard/app/(dashboard)/page.tsx:23-61, 62-68, 77-89, 91-184 (seam 168-170), 189-210, 217-224]
- [Source: apps/dashboard/app/(dashboard)/page.overview.test.tsx:116-156, 172-180; page.coachRedirect.test.tsx:1-60, 109-154]
- [Source: apps/dashboard/components/ui/stat-card.tsx:5-37]
- [Source: apps/dashboard/components/shared/Sidebar.tsx:26-51; apps/dashboard/services/session.ts:37]
- [Source: apps/dashboard/services/subscriptions.ts:222-233, 263, 283-293, 295-343, 365-400]
- [Source: apps/dashboard/app/(dashboard)/subscriptions/page.tsx:16-80; subscriptions/actions.ts:55; subscriptions/components/SubscriptionsPageClient.tsx:17-24, 198-210]
- [Source: apps/dashboard/services/members.ts:140-178, 181-235, 296-322]
- [Source: apps/dashboard/services/classes.ts:24-43, 125-207]
- [Source: apps/dashboard/services/gym-settings.ts:1-45]
- [Source: apps/dashboard/services/csvImport.ts:171, 181, 422; app/(dashboard)/members/components/MemberModal.tsx:107]
- [Source: apps/dashboard/services/payments.getRevenueMtd.test.ts:1-69 — service test mocking shape]
- [Source: apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx:92-95 — allowed gym timezones]
- [Source: packages/types/src/database.ts:1787-1791, 2046-2048]
- [Source: supabase/config.toml:13 (exposed schemas), :18 (max_rows)]
- [Source: supabase/migrations/0003_members_and_users.sql:26, 29]
- [Source: supabase/migrations/0021_subscription_lifecycle_cron.sql:60-86]
- [Source: supabase/migrations/0027_member_app_check_in_result_states.sql:22-24]
- [Source: supabase/migrations/0037_subscriptions_page_manual_renewal.sql:35-58]
- [Source: supabase/migrations/0057_class_creation_scheduling.sql:72-92, 172-174]
- [Source: supabase/migrations/0073_tenant_suspension_enforcement.sql:117, 129, 159]
- [Source: supabase/migrations/0093_supervisor_manager_plus_access.sql:122, 335-371, 475]
- [Source: supabase/migrations/0095_gym_revenue_mtd.sql:43-58, 84-101, 136-171]
- [Source: supabase/tests/gym_revenue_mtd.test.sql:1-122 — fixture style, oracle, role switching]
- [Source: scripts/deploy-0090-0094.sh; docs/runbooks/deploy-0090-0094.md]
- [Source: docs/decisions.md#2026-09-09 — First production deploy (prod head 0094; host psql)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created. Story created 2026-09-10; four scope decisions taken with smartsana during creation and written into `epics.md` and `EXPERIENCE.md`; migration SQL and all four count predicates proven on the local DB in a rolled-back transaction.

### File List
