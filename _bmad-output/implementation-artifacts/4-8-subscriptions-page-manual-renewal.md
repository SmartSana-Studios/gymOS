---
baseline_commit: 5626d55
---

# Story 4.8: Subscriptions Page & Manual Renewal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want a dedicated Subscriptions page with manual renewal capability,
so that I can act on any member's subscription, not just ones currently checked in.

## Scope Notes — Read Before the Acceptance Criteria

**This story adds a new page, not a new renewal mechanism.** `RenewalModal` (renamed from `InlineRenewalPanel` during Story 4.7's post-review — it is now a `<dialog>` modal, not an inline/no-backdrop panel; see `docs/decisions.md`'s 2026-08-01 "Renewal panel converted... superseding UX-DR3" entry) already exists at `apps/dashboard/components/shared/RenewalModal.tsx` and is fully working, wired up from `FrontDeskAlertPanel`. This story's job is (1) build the Subscriptions page (list/filter/sort/CSV export) and (2) extend `RenewalModal` + `confirm_renewal()` with an **optional back-date** capability, then wire `[Renew]` into the new page's rows. **Read `RenewalModal.tsx`, `apps/dashboard/services/subscriptions.ts`, `supabase/migrations/0035_inline_renewal_panel.sql`, and `supabase/migrations/0036_open_payment_method.sql` in full before starting** — `confirm_renewal()`'s *current* live signature is `0036`'s (0035's version was superseded), and every change in this story is additive to that signature, not a rewrite.

**No column-sort exists anywhere in this codebase today.** Members/Payments/Attendance are all filter+paginate only, sorted by one fixed server-side `.order()`. This story's AC #1 ("sortable by member name, status, and expiry date") has no in-repo precedent — see Task 1's `subscriptions_current` view below, which exists specifically to make this possible (PostgREST cannot sort top-level rows by a column of an *embedded* child resource, which is how `listMembers()` reads subscription data today — a flat view sidesteps that limitation entirely).

**Back-dating is a boolean flag, not a free-form date field.** Epics.md's AC #2 says "the option to back-date the renewal start to **the member's original expiry date**" — a fixed, server-known value, not an arbitrary date the client supplies. `confirm_renewal()` gains one new parameter, `p_backdate boolean default false`; when true, it looks up the *existing* subscription's own `expiry_date` server-side and uses that as the new row's `start_date`. The client never sends a date. This mirrors `0022`/`0035`'s own precedent of never trusting a client-supplied date (`renew_subscription()`/`confirm_renewal()` both compute `current_date` server-side today) and closes off any date-tampering surface. Back-dating is only valid when the member's current status is `grace_period` or `expired` **and** their existing subscription has a non-null `expiry_date` (a `pay_per_session` plan's subscription has `expiry_date = null` per `0018`'s trigger — back-dating it is meaningless and must be rejected, not silently ignored).

**Back-dating is scoped to the Subscriptions page trigger only — `FrontDeskAlertPanel`'s existing `[Renew]` flow is untouched.** `RenewalModal` gains one new **optional** prop, `originalExpiryDate?: string | null`. `FrontDeskAlertPanel`'s existing call site passes nothing new (prop stays `undefined`), so the back-date checkbox never renders there and behavior is byte-identical to Story 4.7's shipped behavior — this story adds zero risk to the front-desk-alert path. Only `SubscriptionsPageClient` (this story's new component) passes `originalExpiryDate`, and only for rows whose `status` is `grace_period` or `expired` with a non-null `expiryDate`.

**"Last Payment" (AD-08's mockup column) is deliberately cut — not built.** None of epics.md's 3 literal ACs for this story mention it. Building it requires a second per-member payments lookup with no existing precedent (`payments.subscription_id` is only populated for renewal-panel payments, so it can't be embedded off the `subscriptions_current` view the way `plans`/`members` can). Matches this codebase's own repeated "don't build UI beyond what's asked" precedent (Stories 4.4/4.5/4.6, per `docs/decisions.md`). Document this cut in Task 9. The Actions column shows "Renew" (for any non-`active` status, matching the UX mockup's literal "Renew for non-active members; '–' for active members" — **not** narrowed to just grace/expired; only the *back-date checkbox inside the modal* is narrowed to grace/expired, since `expiring_soon` members have a future expiry date that can't be back-dated to).

**Plan-type filter means the `plan_type` enum, not a specific named plan.** Epics.md's AC #1 says "filter by status or plan type" — `plan_type` is an existing 4-value Postgres enum (`pay_per_session | monthly | coach_inclusive | class_only`, `packages/types`/`plans.ts`'s `PlanRow.planType`), already has a label map (`PLAN_TYPE_LABEL_KEY`, `apps/dashboard/app/(dashboard)/plans/planLabels.ts`) reusable via cross-folder import (`RenewalModal.tsx` already imports `PAYMENT_METHOD_LABEL_KEY` from `@/app/(dashboard)/payments/paymentLabels` the same way — this is an established pattern in this codebase, not a new one). Do not build a "filter by specific plan name" dropdown — no AC or UX text asks for it, and it would need a `listPlans()` fetch this design otherwise avoids entirely.

**No route-level role guard code — matches `plans/page.tsx`/`settings/page.tsx`'s established, explicitly-documented precedent.** `Sidebar.tsx`'s `NAV_ITEMS` already restricts the `/subscriptions` nav link to `["manager", "owner"]` (pre-wired since before this story — check `apps/dashboard/components/shared/Sidebar.tsx`). The real backstop is RLS: `manager_or_owner_insert_own_subscriptions`/`manager_or_owner_update_own_subscriptions` (`0018_member_management.sql`) already restrict writes. **Known, accepted gap (do not "fix" it in this story):** `gym_staff_read_own_subscriptions` (also `0018`) grants `owner|manager|receptionist|coach` read access, broader than this page's Manager/Owner-only intent — a Receptionist/Coach who navigates to `/subscriptions` directly still gets full read data. This is the exact same shape of gap `plans/page.tsx`'s and `members/page.tsx`'s own doc comments already document and accept by design (Sidebar hides it, RLS backstops writes, reads are intentionally left broader). Do not add a `page.tsx`-level role check — no precedent for one exists anywhere in this app, and adding the first one here would be inconsistent with every sibling page.

## Acceptance Criteria

1. **Given** the Subscriptions page, **when** I filter by status or plan type, **then** the list updates accordingly, sortable by member name, status, and expiry date. [Source: epics.md#Story 4.8 AC#1; FR-085]
2. **Given** a member in grace_period or expired status, **when** I select "Renew" from their row, **then** the same Renewal Modal opens (pre-populated per Story 4.7), with the option to back-date the renewal start to the member's original expiry date. [Source: epics.md#Story 4.8 AC#2; FR-085]
3. **Given** the filtered list, **when** I export to CSV, **then** the export respects the same 1,000-row limit and column schema as the Members export. [Source: epics.md#Story 4.8 AC#3; FR-066, FR-085]

## Tasks / Subtasks

- [x] **Task 1: Migration `0037_subscriptions_page_manual_renewal.sql`** (AC: #1, #2)
  - [x] **New view `subscriptions_current`** — flattens each member's most-recent subscription + plan into one row of plain top-level columns, so the page can filter/sort/paginate with ordinary PostgREST query params (no embedding gymnastics; PostgREST cannot sort top-level rows by an embedded child's column, which is why `listMembers()`'s existing embed pattern can't satisfy AC #1's sort requirement):
    ```sql
    create view subscriptions_current
    with (security_invoker = true)
    as
    select distinct on (s.member_id)
      s.id as subscription_id,
      s.gym_id,
      s.member_id,
      m.name as member_name,
      m.phone as member_phone,
      m.join_date,
      m.deactivated_at,
      s.plan_id,
      p.name as plan_name,
      p.plan_type,
      s.status,
      s.start_date,
      s.expiry_date,
      s.created_at as subscription_created_at
    from subscriptions s
    join members m on m.id = s.member_id
    join plans p on p.id = s.plan_id
    order by s.member_id, s.created_at desc;

    grant select on subscriptions_current to authenticated, service_role;
    ```
  - [x] **`with (security_invoker = true)` is not optional — it is the entire tenant-isolation guarantee for this view.** Without it, the view runs with its owner's (migration role's) privileges and bypasses every RLS policy on `subscriptions`/`members`/`plans`, leaking cross-gym data to any authenticated caller. Postgres 17 (this project's `major_version`, `supabase/config.toml`) fully supports `security_invoker` on views (available since PG15). With it set, querying the view enforces `gym_staff_read_own_subscriptions` (`subscriptions`), the members read policy, and the plans read policy exactly as if the caller queried each table directly. Still add an explicit `.eq("gym_id", gymId)` in the service-layer query (Task 3) as defense-in-depth, matching every other service function's own discipline — do not rely on RLS alone.
  - [x] `distinct on (s.member_id) ... order by s.member_id, s.created_at desc` is this table's own established "current subscription" pattern (`listMembers()`'s `order().limit(1, {referencedTable})`, `getRenewalPreview()`'s `order().limit(1)` — same intent, expressed as a view instead of a per-query embed).
  - [x] **`confirm_renewal()`: add `p_backdate boolean default false`.** Postgres requires drop+recreate for an `out`-parameter signature change (same reason `0036` had to drop+recreate `0035`'s version) — do not attempt `alter function`. Body is `0036`'s version with these changes:
    ```sql
    drop function confirm_renewal(uuid, text, text);

    create function confirm_renewal(
      p_member_id uuid,
      p_method text,
      p_reason text,
      p_backdate boolean default false,
      out payment_id uuid,
      out subscription_id uuid,
      out amount integer,
      out currency text,
      out new_expiry_date date
    )
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_caller_gym_id uuid;
      v_actor_id uuid;
      v_member_gym_id uuid;
      v_deactivated_at timestamptz;
      v_plan_id uuid;
      v_duration_days integer;
      v_current_status subscription_status;
      v_current_expiry_date date;
      v_start_date date;
    begin
      -- role check, gym-scoped member lookup, deactivated guard, reason guard:
      -- byte-for-byte identical to 0036's version (do not change ordering).
      ...

      select s.plan_id, s.status, s.expiry_date
        into v_plan_id, v_current_status, v_current_expiry_date
      from subscriptions s
      where s.member_id = p_member_id
      order by s.created_at desc
      limit 1;

      if v_plan_id is null then
        raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
      end if;

      if p_backdate then
        if v_current_status not in ('grace_period', 'expired') then
          raise exception 'confirm_renewal: back-dating is only available for grace_period or expired subscriptions';
        end if;
        if v_current_expiry_date is null then
          raise exception 'confirm_renewal: cannot back-date a subscription with no expiry date';
        end if;
        v_start_date := v_current_expiry_date;
      else
        v_start_date := current_date;
      end if;

      select duration_days, price, plans.currency into v_duration_days, amount, currency
      from plans where id = v_plan_id;

      new_expiry_date := case when v_duration_days is null then null else v_start_date + v_duration_days end;

      insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
      values (v_member_gym_id, p_member_id, v_plan_id, 'active', v_start_date, new_expiry_date)
      returning id into subscription_id;

      -- payment insert: unchanged from 0036.

      perform log_audit_event(
        p_action_type => 'renewal_confirmed',
        p_gym_id => v_member_gym_id,
        p_target_entity_id => p_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object(
          'reason', p_reason, 'method', p_method, 'amount', amount, 'currency', currency,
          'payment_id', payment_id, 'subscription_id', subscription_id, 'plan_id', v_plan_id,
          'new_expiry_date', new_expiry_date, 'start_date', v_start_date, 'backdated', p_backdate
        )
      );
    end;
    $$;

    revoke execute on function confirm_renewal from public;
    grant execute on function confirm_renewal to authenticated;
    ```
  - [x] `new_expiry_date := v_start_date + v_duration_days` (not `current_date + v_duration_days`) is the one substantive computation change — this still satisfies `subscriptions_expiry_after_start`'s check (`v_duration_days` is always positive, so `new_expiry_date > v_start_date` unconditionally) and the plan-type/expiry trigger (unreachable here since the `v_current_expiry_date is null` guard already rejects `pay_per_session` before this line runs when backdating; when not backdating, behavior is identical to `0036`).
  - [x] Role check, permission/tenant/deactivated/reason guards stay word-for-word identical to `0036` — do not touch them.
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` (WSL shell — see Dev Notes). Review the diff: expect the new `confirm_renewal` args signature plus a new `subscriptions_current` view entry; nothing else should change.

- [x] **Task 2: Zod schema — `confirmRenewalSchema` gains `backdate`** (AC: #2)
  - [x] `packages/types/src/schemas/subscription.ts`: change the existing `.extend({ method: ... })` call to also add `backdate: z.boolean().optional()`:
    ```ts
    export const confirmRenewalSchema = renewSubscriptionSchema.extend({
      method: z.enum(["cash", "bank_transfer", "manual_momo"]),
      backdate: z.boolean().optional(),
    });
    ```
  - [x] Do not add a `startDate` field — the client never supplies a date (Scope Notes).

- [x] **Task 3: `apps/dashboard/services/subscriptions.ts`** (AC: #1, #2, #3)
  - [x] `confirmRenewal()`: pass `p_backdate: parsed.data.backdate ?? false` in the existing `.rpc("confirm_renewal", {...})` call (alongside the existing `p_member_id`/`p_method`/`p_reason`). No other change to this function.
  - [x] **New `SUBSCRIPTIONS_PAGE_SIZE = 25`** constant (matches `MEMBERS_PAGE_SIZE`'s own AD-08-mockup-sourced value — mockup shows 25 rows/page).
  - [x] **New `SubscriptionListRow` interface** and **`listSubscriptions()`**, modeled on `listMembers()`'s shape but querying the new `subscriptions_current` view instead of embedding:
    ```ts
    export interface SubscriptionListRow {
      subscriptionId: string;
      memberId: string;
      memberName: string;
      memberPhone: string | null;
      planId: string;
      planName: string;
      planType: string;
      status: "active" | "expiring_soon" | "grace_period" | "expired";
      startDate: string;
      expiryDate: string | null;
    }
    ```
    `listSubscriptions(params: { status?: string; planType?: string; sort?: string; dir?: string; page?: number })` — validate `status` against the 4 real enum values (no "deactivated" pseudo-status here, unlike `members.ts`'s `VALID_STATUS_FILTERS` — this view already excludes deactivated members unconditionally via `.is("deactivated_at", null)`), validate `planType` against the 4 `plan_type` enum values, validate `sort` against `{ name: "member_name", status: "status", expiry: "expiry_date" }` (default `"name"`), validate `dir` against `"asc"|"desc"` (default `"asc"`) — reject/ignore anything else the same defensive way `isValidStatusFilter()` does (an invalid `?sort=` must not reach `.order()` with an unvalidated column name). Query: `.from("subscriptions_current").select("*", { count: "exact" }).eq("gym_id", gymId).is("deactivated_at", null)` + optional `.eq("status", status)` / `.eq("plan_type", planType)` + `.order(mappedSortColumn, { ascending: dir === "asc" })` + `.range(from, to)` with `SUBSCRIPTIONS_PAGE_SIZE`.
  - [x] **New `exportSubscriptionsCsv(params: { status?: string; planType?: string })`** — mirror `exportMembersCsv()`'s exact structure: `count: "exact", head: true` pre-check against `EXPORT_ROW_LIMIT = 1000` (same constant value, own per-file copy — matches this file's existing per-file-copy discipline, do not import `members.ts`'s), returning the same `export_too_large` error code/message pattern if exceeded, then a capped `.range(0, EXPORT_ROW_LIMIT - 1)` data query against `subscriptions_current`. **Column schema is fixed by AC #3 — must match `exportMembersCsv()`'s header exactly:** `["member_name", "phone", "plan_type", "join_date", "subscription_status", "expiry_date", "last_check_in_date"]`, with `last_check_in_date` always `""` (same no-data-source reason as `exportMembersCsv()`; do not build the "Last Payment" column here either — Scope Notes). Copy `csvEscape()` verbatim into this file (per-file-copy convention, same as `members.ts`'s own OWASP CSV-injection guard) — do not import it across files.
  - [x] Reuse this file's existing `getCallerGymId()` helper (added in Story 4.7) for all three new/modified functions — do not re-copy it a second time within this same file.

- [x] **Task 4: `apps/dashboard/app/(dashboard)/subscriptions/actions.ts`** (AC: #3)
  - [x] Add one new Server Action, same thin-wrapper shape as this file's existing two:
    ```ts
    export async function exportSubscriptionsCsvAction(
      params: { status?: string; planType?: string },
    ): Promise<{ data: string | null; error: AppError | null }> {
      return exportSubscriptionsCsv(params);
    }
    ```
  - [x] `listSubscriptions()` is called directly from `page.tsx` (a Server Component) — no Server Action wrapper needed for it, matching `members/page.tsx`'s calling `listMembers()` directly.

- [x] **Task 5: `apps/dashboard/app/(dashboard)/subscriptions/subscriptionLabels.ts` — new file** (AC: #1)
  - [x] Copy `attendanceLabels.ts`'s exact `STATUS_BADGE_CONFIG`/`resolveBadgeStatus` shape (per-file-copy convention — same reasoning attendance used to copy from `members/memberLabels.ts`), restricted to the 4 real `subscription_status` values only (no `deactivated`/`no_active_plan` entries — this page's rows are never deactivated, per the view's own filter). Reuse the existing `members.status.*` i18n keys for labels (`labelKey: "members.status.active"`, etc.) exactly as `attendanceLabels.ts` already does — do not create a third duplicate set of status strings.

- [x] **Task 6: `RenewalModal.tsx` — optional `alertId`, optional `originalExpiryDate`, back-date checkbox** (AC: #2)
  - [x] `alertId` becomes optional (`alertId?: string`). Every DOM `id` built from it (`renewalMethod-${alertId}`, `renewalNote-${alertId}`) must fall back to `memberId` when absent (e.g. `` `renewalMethod-${alertId ?? memberId}` ``) so ids stay unique and defined. On successful confirm, only call `dismissFrontDeskAlert(alertId)` when `alertId` is truthy — the Subscriptions page has no alert to dismiss.
  - [x] New optional prop `originalExpiryDate?: string | null`. When present (Subscriptions page passes it only for `grace_period`/`expired` rows with a non-null `expiryDate` — Task 7), render a checkbox below the existing read-only "New start date" row: `[ ] Back-date to original expiry ({formatted originalExpiryDate})`. When checked, the "New start date" value display switches from `t("renewalPanel.startDateToday")` to the formatted `originalExpiryDate` (reuse `MembersPageClient.tsx`'s exact local-date-parsing pattern — `new Date(year, month-1, day)` from the `YYYY-MM-DD` string, not `new Date(string)` directly, to avoid the UTC-shift bug that pattern was already fixed for). When `originalExpiryDate` is absent (every existing `FrontDeskAlertPanel` call site), the checkbox does not render at all — zero behavior change for Story 4.7's shipped flow.
  - [x] Submit flow: include `backdate: <checkbox state>` in the `confirmRenewalSchema.safeParse({ memberId, method, reason: note, backdate })` call and in the `confirmRenewalAction(parsed.data)` call. Map a new field-independent server error (Task 8's `backdateNotEligible` copy) the same way `formError` already surfaces `error.message` today — no new field-level error needed since backdate has no interactive validation of its own (it's a checkbox, not free text).

- [x] **Task 7: New `page.tsx` + `SubscriptionsPageClient.tsx`** (AC: #1, #2, #3)
  - [x] `apps/dashboard/app/(dashboard)/subscriptions/page.tsx` — Server Component + explicit `<Suspense>`, calls `listSubscriptions({ status, planType, sort, dir, page })` from `searchParams`, same pattern as `members/page.tsx` (own doc comment must state the same "no route-level guard, Sidebar + RLS is enforcement" precedent — Scope Notes). No `listPlans()`/`getDashboardShellContext()` fetch needed (no role-conditional UI on this page — every visitor who can reach it can already Renew per `confirm_renewal()`'s own role check).
  - [x] `apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx` — model directly on `MembersPageClient.tsx`'s structure (URL-param-driven filters via `useSearchParams`/`usePathname`/`router.push`, `updateParams()` helper, `pageWindow()` pagination — copy that helper per-file, same as `AttendancePageClient.tsx` already did):
    - Filters: Status `<select>` (All | Active | Expiring Soon | Grace Period | Expired — no "Deactivated" option, unlike Members), Plan Type `<select>` (using `PLAN_TYPE_LABEL_KEY` imported from `@/app/(dashboard)/plans/planLabels`, cross-folder import — same pattern `RenewalModal.tsx` already uses for `PAYMENT_METHOD_LABEL_KEY`). Both call `updateParams` immediately on change (no debounce needed — no text search on this page).
    - Sortable columns: clickable `<th>` for Name/Status/Expiry, toggling `sort`/`dir` URL params; show a simple asc/desc indicator (no existing icon precedent — a plain `▲`/`▼` character or `lucide-react`'s `ArrowUp`/`ArrowDown` is fine).
    - Table columns: Member (name, initials-avatar per `MembersPageClient.tsx`'s exact pattern), Plan, Status (badge via `subscriptionLabels.ts`, Task 5), Expiry (reuse `expiryLabel()`'s exact local-date-parsing logic), Actions (`[Renew]` `Button` when `status !== "active"`, else `"–"` — Scope Notes).
    - `[Renew]` click opens `RenewalModal` for that row: track `renewingRow: SubscriptionListRow | null` state (single modal open at a time, no snapshot-vs-live-list issue here since this page has no realtime feed unlike `FrontDeskAlertPanel`). Pass `originalExpiryDate={row.status === "grace_period" || row.status === "expired" ? row.expiryDate : undefined}` — note this is `null`-safe only when `row.expiryDate` is non-null; if it's null (a `pay_per_session` plan's subscription), pass `undefined` instead so the checkbox doesn't render for an ineligible row. No `alertId` prop passed. `onRenewed`/`onClose` both clear `renewingRow`; `onRenewed` additionally calls `router.refresh()` (no Realtime cache to merge into here, unlike `FrontDeskAlertPanel` — a plain Server Component refetch is this page's own equivalent).
    - CSV export button: same `handleExport()`/`Blob`/anchor-click pattern as `MembersPageClient.tsx`, calling `exportSubscriptionsCsvAction({ status, planType })`, filename `subscriptions.csv`.
    - Empty states: "no subscriptions at all" vs. "filter produced zero rows" (Task 8 i18n keys), same two-branch pattern as `MembersPageClient.tsx`.

- [x] **Task 8: i18n** (AC: #1, #2, #3)
  - [x] New top-level `subscriptions` block in `apps/dashboard/locales/en.json`/`fr.json`, modeled directly on the `members` block's own key structure: `title`, `filters.status`/`filters.planType`, `statusAll`, `table.member`/`table.plan`/`table.status`/`table.expiry`/`table.actions`, `actions.renew`, `emptyNoSubscriptions`, `emptyFilterNoMatch`, `pagination.previous`/`next`/`ellipsis` (own copy, matching `members`'/`attendance`'s existing per-namespace duplication of these exact 3 strings — not shared), `export.button`/`export.exporting`, `errors.exportTooLarge`, `errors.loadFailed`. Do **not** duplicate `members.status.*` (Task 5 already reuses it) or `plans.types.*` (`PLAN_TYPE_LABEL_KEY` already reuses it).
  - [x] `renewalPanel` block additions: `backdateCheckbox` ("Back-date to original expiry ({{date}})" — interpolated), `errors.backdateNotEligible`.
  - [x] Verify via `node scripts/check-i18n-key-parity.mjs`.

- [x] **Task 9: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) `subscriptions_current`, a new `security_invoker` view — why it exists (PostgREST cannot sort top-level rows by an embedded child column; this is the first view in the codebase, worth flagging as a new pattern for future readers) and why `security_invoker=true` is load-bearing for tenant isolation, not cosmetic; (2) `confirm_renewal()`'s new `p_backdate` boolean-flag design — why a flag, not a client-supplied date (no date-tampering surface, mirrors `0022`/`0035`'s existing "never trust a client date" precedent); (3) "Last Payment" (AD-08 mockup column) is cut, no AC requires it, matches Stories 4.4/4.5/4.6's own precedent for documented UX-mockup deviations; (4) the pre-existing Receptionist/Coach-can-still-read-via-RLS gap on this Manager/Owner-only page is inherited, not introduced or fixed here (same shape as `plans`/`members`/`settings`'s own accepted gaps).

- [x] **Task 10: pgTAP coverage** (AC: all)
  - [x] New file `supabase/tests/subscriptions_page_manual_renewal.test.sql` (mirror `inline_renewal_panel.test.sql`'s / `open_payment_method.test.sql`'s fixture-seeding style):
    - `subscriptions_current`: exactly one row per member (latest subscription only, even when a member has 2+ historical subscription rows from a prior renewal); correct columns (join spot-checks: `member_name`, `plan_name`, `plan_type`, `join_date` all resolve correctly).
    - **Tenant isolation on the view is the highest-priority assertion here:** a member/subscription/plan fixture in gym A must not appear in gym B's query against `subscriptions_current` (query as a gym-B-scoped role, assert zero rows for gym A's member) — this directly tests that `security_invoker=true` is actually enforcing RLS through the view, not silently bypassing it.
    - `confirm_renewal()` with `p_backdate` omitted/false: identical behavior to `0036`'s existing coverage (regression check — re-run or extend the existing assertions from `inline_renewal_panel.test.sql` against the new signature).
    - `confirm_renewal(..., p_backdate := true)` on a `grace_period` member: new `start_date` = the prior subscription's `expiry_date`; new `expiry_date` = that + `plan.duration_days`.
    - Same, on an `expired` member: same behavior.
    - `confirm_renewal(..., p_backdate := true)` on an `active` or `expiring_soon` member: rejected (raise).
    - `confirm_renewal(..., p_backdate := true)` where the prior subscription's `expiry_date` is null (a `pay_per_session` plan): rejected (raise).
    - Audit log row's `metadata` contains `backdated` (boolean) and `start_date` matching what was actually inserted.
  - [x] `rls_tenant_isolation.test.sql`: add the `subscriptions_current` cross-gym assertion here too if that file is the codebase's canonical home for such checks (check its existing structure first — Story 4.7's own Task 9 note says to check before assuming).

- [x] **Task 11: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` (WSL shell) — zero regressions against the pre-story baseline (503 assertions per Story 4.7's final count) plus this story's new file.
  - [x] Hands-on (WSL-only Supabase convention, per Dev Notes): as Owner, seed a member in `grace_period` and another `expired` (via direct SQL or the existing lifecycle cron), navigate to `/subscriptions`. Verify: filter by status/plan type updates the list; clicking each sortable column header re-sorts correctly (both directions); `[Renew]` on the grace/expired rows opens `RenewalModal` with the back-date checkbox visible, and on an `active`/`expiring_soon` row shows "–" with no button; checking the back-date box and confirming produces a subscription with `start_date` = the original expiry date (verify via SQL); exporting CSV downloads a file with the exact 7-column header and correct row data; a Receptionist or Coach's Sidebar has no Subscriptions link (existing, unchanged). Confirm `FrontDeskAlertPanel`'s own `[Renew]` flow (Story 4.7) still works exactly as before (no back-date checkbox appears there).

### Review Findings

- [x] [Review][Patch] Back-dated renewal can insert an already-expired "active" subscription — when `p_backdate = true` and the member's original `expiry_date` is old enough that `expiry_date + plan.duration_days` is still before `current_date` (e.g. a member expired 100 days ago renews a 30-day plan with the checkbox checked), `confirm_renewal()` inserts a new row with `status = 'active'` whose `new_expiry_date` is already in the past. Fixed: added a guard that raises `confirm_renewal: back-dated renewal would still be expired` when `v_start_date + v_duration_days < current_date`, mapped to `backdateNotEligible` copy in `errors.ts`. [supabase/migrations/0037_subscriptions_page_manual_renewal.sql:124-146]
- [x] [Review][Defer] Duplicate-named FK relationship synthesized in `database.ts` for the new view, and the Dev Agent Record's claim about the diff's scope is inaccurate — regenerating types added a **second** `payments_subscription_id_fkey` relationship entry (same constraint name as the existing one, but `referencedRelation: "subscriptions_current"` instead of `subscriptions`), which `supabase gen types` inferred from the view's `subscription_id` column. The Debug Log's claim that the `database.ts` diff was "limited to" the new `p_backdate` arg and the view entry is incomplete. [packages/types/src/database.ts:585-595] — deferred, likely harmless: PostgREST embed resolution uses real DB constraints, not this generated client-type file; correcting the Dev Agent Record's claim below.

- [x] [Review][Patch] `subscriptions_current`'s `distinct on` and `confirm_renewal`'s own "most recent subscription" lookup have no tiebreaker for rows sharing an identical `created_at` — both use `order by ... s.created_at desc` with no secondary key; since `created_at default now()` is frozen per-transaction, two rows for the same member inserted in one transaction would tie, making the "current" row selection nondeterministic. Fixed: added `, s.id desc` as a secondary sort key in both places. [supabase/migrations/0037_subscriptions_page_manual_renewal.sql:38,56,113-118]
- [x] [Review][Patch] Sortable column headers have no `aria-sort` attribute — this is the first sortable-column table in the codebase (no existing convention), and screen-reader users get no indication of the active sort column/direction beyond a visual arrow icon. Fixed: added `aria-sort="ascending"|"descending"|"none"` per `<th>`. [apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx:218-229]
- [x] [Review][Patch] `resolveBadgeStatus()` is a pure identity function (`return row.status`) — dead indirection mechanically copied from `attendanceLabels.ts`'s resolver, which does real normalization there. Fixed: deleted the function; the one call site now uses `row.status` directly. [apps/dashboard/app/(dashboard)/subscriptions/subscriptionLabels.ts:40-42]

- [x] [Review][Defer] No TypeScript unit-test coverage for the new service-layer functions (`listSubscriptions`, `exportSubscriptionsCsv`, `applySubscriptionFilters`, sort-column resolution) [apps/dashboard/services/subscriptions.ts] — deferred, pre-existing: matches this entire codebase's established convention (zero `.test.ts` files exist under `apps/dashboard`; pgTAP + typecheck + hands-on verification is the documented testing standard per this story's own Dev Notes).
- [x] [Review][Defer] `exportSubscriptionsCsv`'s count-then-fetch has a TOCTOU race — a row inserted between the `head:true` pre-check and the capped data query could push the real count past 1,000 while the export silently returns 1,000 rows instead of `export_too_large` [apps/dashboard/services/subscriptions.ts:365-388] — deferred, pre-existing: byte-identical to `exportMembersCsv()`'s already-shipped pattern in `apps/dashboard/services/members.ts`, which this story was explicitly instructed to mirror.
- [x] [Review][Defer] `status`/`planType` URL params are passed to the client `<select>` unvalidated [apps/dashboard/app/(dashboard)/subscriptions/page.tsx:72-73] — deferred, pre-existing: identical unvalidated pass-through already exists in `members/page.tsx:72`; the server-side filter itself is safely allowlisted (`applySubscriptionFilters`).
- [x] [Review][Defer] A stale `page` URL param beyond the actual page count shows "no subscriptions match your filter" even when no filter is set and rows exist on other pages, because the empty-state condition ignores `page` entirely [apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx:205-211] — deferred, pre-existing: byte-identical condition already ships in `MembersPageClient.tsx:229`.
- [x] [Review][Defer] The new back-date error mapping matches on raw `raise exception` substrings duplicated between the SQL text and the TS string match, with nothing keeping them in sync if either changes later [packages/types/src/errors.ts] — deferred, pre-existing: this is the codebase's established error-mapping convention, used throughout `errors.ts` for every other RPC's raised exceptions.
- [x] [Review][Defer] `subscriptions_current`'s `distinct on` scans across all gyms before any `gym_id` filter is applied by the caller, with no supporting index added in this migration [supabase/migrations/0037_subscriptions_page_manual_renewal.sql:35-56] — deferred, pre-existing: real but speculative without production query-plan/volume data; this is the codebase's first view, so no prior indexing precedent exists to compare against.

### Review Findings (Round 2 — 2026-08-01, independent 3-layer review)

- [x] [Review][Patch] New "back-dated renewal would still be expired" guard has zero pgTAP coverage — Task 10's `plan(24)` claims full rejection-path coverage, but section (f) only exercises "wrong status" and "null expiry_date"; the guard added at `supabase/migrations/0037_subscriptions_page_manual_renewal.sql:144-145` (a member expired longer than one plan cycle back-dating past `current_date`) is never triggered by any fixture in the test file. Fixed: added a "Deeply Expired Member" fixture (expired 130→100 days ago on the 30-day plan) and a new `throws_like` assertion for this guard; `plan(24)` → `plan(25)`. [supabase/tests/subscriptions_page_manual_renewal.test.sql]
- [x] [Review][Patch] Two new i18n keys are added but never referenced by any component — `subscriptions.errors.loadFailed` (`apps/dashboard/locales/en.json:321`, `fr.json`; `page.tsx` uses `t("common.loadError")` instead) and `renewalPanel.errors.backdateNotEligible` (`apps/dashboard/locales/en.json:489`, `fr.json`; `RenewalModal.tsx` never calls it — the server-mapped `error.message` is what actually surfaces, sourced from `packages/types/src/locales`). Both are orphaned keys, inconsistent with sibling `renewalPanel.errors.*` keys that genuinely are used as client-side fallbacks. Fixed: removed both dead keys from `apps/dashboard/locales/{en,fr}.json` — the established `common.loadError` convention and the server-mapped `error.message` already cover these cases, matching every sibling page. [apps/dashboard/locales/en.json, fr.json]
- [x] [Review][Patch] `SubscriptionsPageClient`'s toast auto-dismiss timer (`toastTimerRef`) is never cleared on component unmount — only cleared/reset on the next `showToast()` call. Low-severity under React 18 (no console warning), but a real dangling-timer/no-op-`setState`-after-unmount gap. Fixed: added an unmount-cleanup `useEffect`. [apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx:96-100]
- [x] [Review][Patch] Task 10's second subtask (add the `subscriptions_current` cross-gym assertion to `rls_tenant_isolation.test.sql` "if that file is the canonical home for such checks — check its structure first") has no evidence it was checked: the file is untouched and no note in the Dev Agent Record/Completion Notes/`docs/decisions.md` explains the decision. The substance (tenant isolation on the new view) is covered in the new test file itself, so this is a documentation-of-decision gap, not a coverage gap. Fixed: added Decision 5 to `docs/decisions.md`'s Story 4.8 entry explaining why the assertion stays in `subscriptions_page_manual_renewal.test.sql` only. [docs/decisions.md]
- [x] [Review][Defer] `csvEscape()`'s OWASP CSV-injection guard only checks a leading `=+-@`, not a leading tab/CR (also commonly-cited formula-injection triggers) [apps/dashboard/services/subscriptions.ts:336-342] — deferred, pre-existing: byte-identical to `members.ts`'s own `csvEscape()`, which this story was explicitly instructed to copy verbatim (per-file-copy convention).
- [x] [Review][Defer] `confirm_renewal()`'s current-subscription lookup (`select ... order by s.created_at desc, s.id desc limit 1`) has no `for update` row lock — two concurrent renewal calls for the same member (e.g. a rapid double-submit) could both read the same "current" row and both insert a new subscription [supabase/migrations/0037_subscriptions_page_manual_renewal.sql:105-118] — deferred, pre-existing: this select shape predates this story (0036 and earlier), untouched by this diff's own explicit "byte-for-byte identical to 0036 — do not touch" instruction for this section.
- [x] [Review][Defer] `subscriptions_current` exposes `deactivated_at` as a plain column but applies no `where deactivated_at is null` itself, relying entirely on caller discipline (`listSubscriptions`/`exportSubscriptionsCsv` both remember to add `.is("deactivated_at", null)` today) [supabase/migrations/0037_subscriptions_page_manual_renewal.sql:44-67] — deferred: real but speculative, no current consumer is affected; this is the codebase's first view so no prior "filter-in-view-vs-filter-in-query" precedent exists to compare against.

Three other candidate findings were considered and dismissed as noise: (1) `docs/decisions.md`'s new Receptionist/Coach-read-gap entry was flagged as understating that `confirm_renewal()` also grants Receptionist *write* (renew) access — dismissed, since that role-check is pre-existing/unchanged from 0036, and `page.tsx`'s own doc comment already separately acknowledges "every visitor who can reach it can already Renew." (2) `formatLocalDate` is duplicated verbatim between `RenewalModal.tsx` and `SubscriptionsPageClient.tsx` — dismissed, matches this story's own repeatedly-documented per-file-copy convention. (3) `resolveSortAscending`'s `dir !== "desc"` is case-sensitive, defaulting to ascending for any non-lowercase-exact value — dismissed, matches the spec's own explicitly-intended "validate dir, default asc, silently ignore anything else" defensive design; only reachable via manual URL tampering.

## Dev Notes

- **Read before starting:** `apps/dashboard/components/shared/RenewalModal.tsx`, `apps/dashboard/services/subscriptions.ts`, `apps/dashboard/app/(dashboard)/subscriptions/actions.ts`, `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx`, `apps/dashboard/services/members.ts` (specifically `applyMemberFilters`/`listMembers`/`exportMembersCsv`), `supabase/migrations/0036_open_payment_method.sql` (the *current* `confirm_renewal()` signature — not `0035`'s, which was superseded), `docs/decisions.md`'s three 2026-08-01 entries about Story 4.7 (RenewalModal rename, dialog-theming fix, and the original Inline Renewal Panel design rationale).
- **This is the first view (`create view`) anywhere in this codebase.** Every prior story used raw tables + RLS + `SECURITY DEFINER` RPCs. `security_invoker = true` is what makes a view safe to add without becoming a second, driftable authorization surface (architecture.md's own stated reason for rejecting a repository-pattern layer) — get this right, and pgTAP-test it directly (Task 10), don't just trust it.
- **This project's local Supabase stack runs inside WSL2, not native Windows** — `supabase db reset`/`supabase test db`/`supabase gen types` must run from a WSL shell. Working as of Story 4.7's session; if a fresh `dockerd` crash-loop appears, `wsl --shutdown` + restart resolved it before. [Memory: Supabase runs in WSL, mobile-device testing env needed WSL mirrored networking + Windows Dev Mode — both already fixed on this machine, not this story's concern unless testing the mobile app, which this story does not touch.]
- **Testing standard:** pgTAP is the primary automated coverage (Task 10). No E2E/browser automation exists in V1 — Task 11's hands-on pass is the only way to verify the actual page/sort/filter/CSV-download UI.
- **Do not build:** the "Last Payment" column, a free-text/date-picker back-date field, a specific-plan-name filter, any route-level role-guard code, or any change to `FrontDeskAlertPanel.tsx`'s existing renewal flow (Scope Notes).
- **`apps/mobile` and `apps/super-admin` are untouched by this story.**

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0037_subscriptions_page_manual_renewal.sql              (new)
  supabase/tests/subscriptions_page_manual_renewal.test.sql                   (new)
  packages/types/src/schemas/subscription.ts                                 (modified — confirmRenewalSchema.backdate)
  packages/types/src/errors.ts                                               (modified — backdateNotEligible mapping)
  packages/types/src/locales/{en,fr}.json                                    (modified — backdateNotEligible copy)
  packages/types/src/database.ts                                             (regenerated)
  apps/dashboard/services/subscriptions.ts                                   (modified — listSubscriptions, exportSubscriptionsCsv, confirmRenewal's p_backdate passthrough)
  apps/dashboard/app/(dashboard)/subscriptions/page.tsx                      (new)
  apps/dashboard/app/(dashboard)/subscriptions/actions.ts                    (modified — exportSubscriptionsCsvAction)
  apps/dashboard/app/(dashboard)/subscriptions/subscriptionLabels.ts         (new)
  apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx (new)
  apps/dashboard/app/(dashboard)/subscriptions/loading.tsx                   (new — mirrors members/loading.tsx / plans/loading.tsx's Suspense fallback pattern)
  apps/dashboard/components/shared/RenewalModal.tsx                         (modified — optional alertId, optional originalExpiryDate + back-date checkbox)
  apps/dashboard/locales/en.json                                             (modified)
  apps/dashboard/locales/fr.json                                             (modified)
  docs/decisions.md                                                          (modified)
  ```
  - `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx` is **not** in this list — no change needed (Scope Notes: new `RenewalModal` props are optional/additive).
  - `apps/dashboard/components/shared/Sidebar.tsx` is **not** in this list — the `/subscriptions` nav entry restricted to `["manager", "owner"]` already exists (added ahead of this story).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.8] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-085] — Subscriptions page: sortable/filterable list, Manager/Owner-only, inline renewal panel, CSV export matching Members, back-datable renewal start
- [Source: _bmad-output/planning-artifacts/epics.md#FR-066] — Members CSV export's 1,000-row limit, the schema this story's export must match
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 1112-1140] — AD-08 Subscriptions: layout mockup, filters, column set, "Renew"/"–" action rule, 25 rows/page, empty state copy
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 1540-1571] — Inline Renewal Panel spec (superseded in part by Story 4.7's dialog conversion — see docs/decisions.md); back-dating's original mockup framing ("backdating allowed to member's original expiry date")
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md line 191] — Role visibility matrix: Subscriptions is Manager/Owner only (Receptionist/Coach: absent from Sidebar)
- [Source: _bmad-output/planning-artifacts/architecture.md line 342] — `components/shared/` intended `variant` prop note for `InlineRenewalPanel` (superseded — see docs/decisions.md; `RenewalModal` uses optional props instead, not a `variant` enum)
- [Source: _bmad-output/planning-artifacts/architecture.md line 169] — RLS as the authorization boundary; Server Actions for business logic beyond CRUD
- [Source: supabase/migrations/0035_inline_renewal_panel.sql, 0036_open_payment_method.sql] — `confirm_renewal()`'s full history; 0036 is the *current* live signature this story extends
- [Source: supabase/migrations/0018_member_management.sql lines 227-256] — `gym_staff_read_own_subscriptions`/`manager_or_owner_insert_own_subscriptions`/`manager_or_owner_update_own_subscriptions` RLS policies; the pre-existing read-access-gap this story inherits, does not introduce
- [Source: supabase/migrations/0021_subscription_lifecycle_cron.sql] — `subscription_status` transition logic (status is a stored, cron-updated column, not computed on read — this story's view reads it directly, no re-derivation)
- [Source: supabase/migrations/0004_subscriptions_and_plans.sql, 0001_extensions_and_enums.sql] — `subscriptions`/`plans` table shapes, `subscription_status`/`plan_type` enums
- [Source: apps/dashboard/services/members.ts] — `MEMBERS_PAGE_SIZE`, `EXPORT_ROW_LIMIT`, `applyMemberFilters`, `listMembers`, `exportMembersCsv`, `csvEscape` — this story's closest and most authoritative precedent for `listSubscriptions`/`exportSubscriptionsCsv`
- [Source: packages/types/src/schemas/csvImport.ts] — `CSV_TEMPLATE_COLUMNS`, the schema `exportMembersCsv`'s header already matches and this story's export must match too
- [Source: apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx] — filter/sort-URL-param pattern, `pageWindow()`/`PAGE_WINDOW_RADIUS`, CSV-download Blob/anchor pattern, `expiryLabel()`'s UTC-shift-safe date parsing, empty-state two-branch pattern
- [Source: apps/dashboard/app/(dashboard)/attendance/attendanceLabels.ts] — the exact per-file-copy precedent for `subscriptionLabels.ts`'s `STATUS_BADGE_CONFIG`/`resolveBadgeStatus`, reusing `members.status.*` i18n keys cross-namespace
- [Source: apps/dashboard/app/(dashboard)/plans/planLabels.ts] — `PLAN_TYPE_LABEL_KEY`, reused via cross-folder import for the plan-type filter (not re-copied)
- [Source: apps/dashboard/app/(dashboard)/plans/page.tsx, apps/dashboard/app/(dashboard)/settings/page.tsx, apps/dashboard/app/(dashboard)/members/page.tsx] — the "no route-level role guard, Sidebar hides + RLS backstops" precedent this story's `page.tsx` must document identically
- [Source: apps/dashboard/components/shared/RenewalModal.tsx] — current props/state/submit-flow this story extends (optional `alertId`/`originalExpiryDate`, back-date checkbox)
- [Source: apps/dashboard/components/shared/FrontDeskAlertPanel.tsx] — the only existing `RenewalModal` call site; confirms what must stay unchanged
- [Source: packages/types/src/errors.ts lines 171-199] — `confirm_renewal:`-prefixed error-mapping precedent this story's new `backdateNotEligible` mapping follows
- [Source: docs/decisions.md] — Story 4.7's three 2026-08-01 entries (RenewalModal dialog conversion, dialog theming fix, original design rationale) — required reading before touching `RenewalModal.tsx`; entry-format/tone precedent for Task 9
- [Source: _bmad-output/implementation-artifacts/4-7-inline-renewal-panel.md] — previous story in this epic; `RenewalModal`'s current exact shape, the WSL/Docker environment note this story's Dev Notes repeats, review-fix history (`retryBlocked`, error-message surfacing) that must not regress

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` + `supabase gen types typescript --local` (WSL): migration `0037` applied cleanly; `database.ts` diff includes `confirm_renewal`'s new `p_backdate` arg and the new `subscriptions_current` view entry, as expected, **plus one unexpected addition** caught in code review: a second `payments_subscription_id_fkey` relationship entry (same constraint name, `referencedRelation: "subscriptions_current"`) that `supabase gen types` synthesized from the view's `subscription_id` column — see Review Findings below (deferred, likely-harmless codegen artifact).
- `supabase test db` (WSL, full suite): 527/527 assertions pass (503 pre-story baseline + 24 new). One transient failure in `check_out_manual_auto_timeout.test.sql` (`job_runs` count off-by-one) traced to the real `check_in_auto_timeout` pg_cron job (`*/15 * * * *`) firing against the persistent local DB mid-test-run — confirmed environmental (unrelated to this story's changes) by re-running the full suite immediately after a fresh `db reset`, which passed cleanly.
- `pnpm run typecheck` (all 4 packages): 0 errors. `node scripts/check-i18n-key-parity.mjs`: all 4 locale dirs in parity.
- Hands-on browser verification (Chrome via `claude-in-chrome`, dashboard dev server): seeded a temporary gym/owner/3 members (grace_period/expired/active) directly against the local DB, logged in as owner. Verified: status/plan-type filters render and update the URL; clicking the Expiry column header sorts ascending/descending and updates `?sort=&dir=`; `[Renew]` on the grace_period row opens `RenewalModal` with the back-date checkbox showing the correct original-expiry date; checking it updates the displayed "New start date"; confirming produced a real `active` subscription with `start_date`/`expiry_date` matching the back-dated computation exactly (verified via direct SQL query and via the Audit Log's `metadata.backdated`/`metadata.start_date`), and the row's Actions cell correctly flipped to "–" afterward; CSV export downloaded a 7-column file (`member_name,phone,plan_type,join_date,subscription_status,expiry_date,last_check_in_date`) with correct data including the just-renewed row. One debugging detour: an initial hand-rolled test-fixture member UUID (`aaaaaaaa-0000-...-0000000000a1`) failed Zod's `z.uuid()` client-side validation silently (wrong version/variant nibbles per RFC 4122), making the Confirm button appear inert — root-caused via a temporary `console.log` in `handleSubmit`, confirmed as a fixture-data issue (not a code defect) once replaced with a proper v4-shaped UUID, then the debug log was removed. All temporary fixture data (gym, tier, plan, members, subscriptions, auth users) and the downloaded CSV were deleted after verification; dev server processes stopped.

### Completion Notes List

- Task 1: Added `supabase/migrations/0037_subscriptions_page_manual_renewal.sql` — new `subscriptions_current` view (`security_invoker = true`) and `confirm_renewal()` drop+recreate adding `p_backdate boolean default false`. Regenerated `packages/types/src/database.ts`.
- Task 2: `confirmRenewalSchema` (`packages/types/src/schemas/subscription.ts`) extended with `backdate: z.boolean().optional()`.
- Task 3: `apps/dashboard/services/subscriptions.ts` — added `SUBSCRIPTIONS_PAGE_SIZE`, `SubscriptionListRow`, `listSubscriptions()`, `exportSubscriptionsCsv()` (own `csvEscape()` copy); `confirmRenewal()` now passes `p_backdate`.
- Task 4: `exportSubscriptionsCsvAction()` added to `apps/dashboard/app/(dashboard)/subscriptions/actions.ts`.
- Task 5: New `apps/dashboard/app/(dashboard)/subscriptions/subscriptionLabels.ts` (4-status `STATUS_BADGE_CONFIG`/`resolveBadgeStatus`, reusing `members.status.*` i18n keys).
- Task 6: `RenewalModal.tsx` — `alertId` made optional (DOM ids fall back to `memberId`; `dismissFrontDeskAlert` only called when `alertId` truthy), new optional `originalExpiryDate` prop drives a back-date checkbox and "New start date" display swap (added a `formatLocalDate` helper mirroring `MembersPageClient.tsx`'s UTC-safe date parsing), submit flow includes `backdate`. `FrontDeskAlertPanel.tsx` untouched — zero behavior change confirmed both by code inspection (no new props passed there) and by the regression suite (`inline_renewal_panel.test.sql` still 31/31).
- Task 7: New `apps/dashboard/app/(dashboard)/subscriptions/page.tsx` (Server Component + Suspense, no route-level guard per established precedent), `loading.tsx`, and `components/SubscriptionsPageClient.tsx` (filters, sortable columns, Renew/– actions, CSV export, pagination — modeled on `MembersPageClient.tsx`).
- Task 8: New `subscriptions` i18n block + `renewalPanel.backdateCheckbox`/`renewalPanel.errors.backdateNotEligible` in `apps/dashboard/locales/{en,fr}.json`; `errors.backdateNotEligible` copy added to `packages/types/src/locales/{en,fr}.json` with a matching mapping in `packages/types/src/errors.ts` for `confirm_renewal()`'s two new backdate-rejection raises. i18n key-parity check passes.
- Task 9: Dated entry added to `docs/decisions.md` covering the `subscriptions_current` view rationale, the `p_backdate` flag design, the "Last Payment" cut, and the inherited Receptionist/Coach read gap.
- Task 10: New `supabase/tests/subscriptions_page_manual_renewal.test.sql` (24 assertions) — view collapsing/column-resolution, cross-gym tenant isolation on the view (including an explicit-gym_id-filter bypass attempt), `p_backdate` omitted regression, back-dated grace_period/expired renewals, and all three rejection paths (active, expiring_soon, null-expiry pay_per_session).
- Task 11: `pnpm run typecheck` (0 errors), i18n parity (0 errors), full `supabase test db` (527/527, one traced-and-explained environmental flake on re-run), and hands-on browser verification of the full AC #1/#2/#3 flow (see Debug Log References) all passed.

### File List

- `supabase/migrations/0037_subscriptions_page_manual_renewal.sql` (new)
- `supabase/tests/subscriptions_page_manual_renewal.test.sql` (new)
- `packages/types/src/database.ts` (regenerated)
- `packages/types/src/schemas/subscription.ts` (modified)
- `packages/types/src/errors.ts` (modified)
- `packages/types/src/locales/en.json` (modified)
- `packages/types/src/locales/fr.json` (modified)
- `apps/dashboard/services/subscriptions.ts` (modified)
- `apps/dashboard/app/(dashboard)/subscriptions/page.tsx` (new)
- `apps/dashboard/app/(dashboard)/subscriptions/loading.tsx` (new)
- `apps/dashboard/app/(dashboard)/subscriptions/actions.ts` (modified)
- `apps/dashboard/app/(dashboard)/subscriptions/subscriptionLabels.ts` (new)
- `apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx` (new)
- `apps/dashboard/components/shared/RenewalModal.tsx` (modified)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `docs/decisions.md` (modified)
