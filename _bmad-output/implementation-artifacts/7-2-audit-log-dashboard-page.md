---
baseline_commit: 55eda463ae8930179363d92ee7bd3e1b257a5993
---

# Story 7.2: Audit Log Dashboard Page

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want to browse and filter the audit log,
so that I can reconstruct what happened and by whom.

## Acceptance Criteria

1. **Given** the `/audit` page (Sidebar nav entry `nav.auditLog` already exists at `apps/dashboard/components/shared/Sidebar.tsx:42`, gated `["manager", "owner"]`, but the route itself does not exist yet), **when** a Manager or Owner views it, **then** it renders a table with columns Timestamp, Actor, Action, Target, Details (per `EXPERIENCE.md` AD-12) sourced from `audit_log`, and the page is strictly read-only: no hover state implying editability on any row, no right-click context menu, no row-selection checkbox, and no edit/delete/flag button or link anywhere on the page.

2. **Given** the page, **when** I set a date range (two native `<input type="date">` elements, defaulting to the last 7 days — `[today - 7 days, today]`) and/or select an actor from the Actor filter dropdown (populated from distinct actors in my own gym's audit log), **then** the table re-queries, resets to page 1, and shows results newest-first (`created_at desc`), paginated 50 records per page (FR-068's literal value, not a mockup guess) with Previous/Next controls; when the filtered result set is empty, the page shows "No audit records for this period." (`EXPERIENCE.md` AD-12's exact empty-state copy).

3. **Given** `audit_log` has had RLS enabled with zero gym-admin-facing policies since `0007_audit_log.sql` (only `super_admin_read_audit_log` exists today, `0012_super_admin_data_access_escalation.sql:18-20` — both files' own comments explicitly defer the Manager/Owner-scoped read policy to this story), **when** this story ships, **then** a new gym-scoped `manager_or_owner_read_own_audit_log` RLS SELECT policy is the only mechanism that makes AC #1/#2 return rows: a Receptionist or Coach session that reaches `/audit` directly (bypassing the Sidebar's role filter) sees zero rows, not an error page; and a Manager/Owner session never sees another gym's audit rows, even via a hand-edited request (tenant isolation, `gym_id = private.gym_id()`).

4. **Given** I am an Owner, **when** I click "Export CSV" on the currently-filtered results, **then** a CSV downloads containing all matching rows (capped at 1,000 rows, matching the established Members/Subscriptions export ceiling convention — FR-081 itself sets no explicit cap, this extrapolates the codebase's standing pattern) using the active date-range/actor filters; **given** I am a Manager, **when** I view the same page, **then** the Export CSV button is not rendered at all, **and** a direct call to the underlying export Server Action from a Manager session is rejected server-side with a forbidden-style error (client-side hiding alone is not acceptance — this must be enforced in the service/action layer, not just the UI).

## Tasks / Subtasks

- [x] **Task 1: Add the Manager/Owner-scoped RLS read policy + its pgTAP coverage** (AC #3)
  - [x] Create `supabase/migrations/0049_audit_log_dashboard_read_policy.sql` (next sequential number after `0048_audit_record_coverage_verification.sql`, which is present in the working tree but not yet committed — this story's `baseline_commit` matches Story 7.1's own, since 7.1 hasn't landed on `main`/been committed yet either).
  - [x] Add exactly one policy, mirroring `manager_or_owner_read_own_coach_assignments` (`supabase/migrations/0039_coach_member_assignment.sql:49-57`) and `manager_or_owner_read_own_session_notes` (`0041_coach_portal_member_detail_session_notes.sql:70-75`) — **not** `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` (`0018_member_management.sql`), which wrongly include `receptionist`/`coach`:
    ```sql
    create policy "manager_or_owner_read_own_audit_log" on audit_log
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
      );
    ```
    This coexists (OR'd) with the existing `super_admin_read_audit_log` policy (`0012_super_admin_data_access_escalation.sql:18-20`) — do not modify that policy. No `gym_id is not null` guard is needed: `private.gym_id()` is never null for a Manager/Owner session, and pg_cron job-failure rows (nullable `gym_id`, `0007_audit_log.sql:16-19`) never match by construction (`null = null` is falsy in SQL).
  - [x] No new index is needed — `idx_audit_log_gym_id`, `idx_audit_log_actor_id`, `idx_audit_log_created_at` (`0007_audit_log.sql:61-63`) and the composite `idx_audit_log_gym_actor_action` (`0012_super_admin_data_access_escalation.sql:66`) already cover this page's `gym_id` + `created_at` range + `actor_id` equality access pattern.
  - [x] Create `supabase/tests/audit_log_manager_owner_read.test.sql` (a new file, matching this codebase's one-test-file-per-story-feature norm — e.g. `coach_member_assignment.test.sql` for `0039` — rather than inflating the existing, differently-scoped `audit_log_immutable.test.sql`, which covers append-only enforcement, not SELECT access). Use `coach_member_assignment.test.sql:245-275`'s exact fixture/assertion shape (`set local role authenticated;` + `select set_config('request.jwt.claims', '{"sub":"...","role":"authenticated","gym_id":"...","app_role":"..."}', true);` + `select is((select count(*)::int from audit_log where ...), <expected>, '<description>');`). Seed at least two gyms' worth of `audit_log` rows (via `log_audit_event()` as `service_role`, or a direct seed insert) and assert:
    1. An `owner`-claim session sees its own gym's audit rows.
    2. A `manager`-claim session sees the same rows as the owner (same count).
    3. A `receptionist`-claim session sees `0` rows.
    4. A `coach`-claim session sees `0` rows.
    5. An `owner`/`manager`-claim session sees `0` rows when queried against a **different** gym's audit rows (tenant isolation).
    6. Regression guard: a `super_admin`-claim session still sees all rows across gyms after this migration (confirms the new policy didn't accidentally interfere with the existing OR'd `super_admin_read_audit_log` policy).

- [x] **Task 2: Build the service layer — `apps/dashboard/services/auditLog.ts`** (AC #1, #2, #4)
  - [x] Name the file `auditLog.ts`, not `audit.ts` — matches `architecture.md`'s own file-tree naming (`architecture.md:342`) even though its "no actions.ts" note for this page is superseded (see Task 4).
  - [x] Copy this app's established per-file-copy conventions (do not import these from other service files):
    - `getCallerGymId`-equivalent helper reading `supabase.auth.getClaims()` (pattern: `apps/dashboard/services/payments.ts:20-22`'s own copy of `members.ts`'s helper) — extend it to also return `role` (`claims.app_role as MemberRole`, per `apps/dashboard/services/session.ts:97`), since Task 4's export gate needs it.
    - `csvEscape()` (OWASP CSV-injection guard), copied verbatim from `apps/dashboard/services/subscriptions.ts:334-342`.
    - Date-range helpers copied from `apps/dashboard/services/attendance.ts:51-83`: `todayUtcDate()`, `dateStartIso()`, `dateEndExclusiveIso()`, `isValidDateString()`, `resolveDateParam()` — apply the default-to-last-7-days fallback (`from = today - 7 days`) instead of Attendance's default-to-today.
  - [x] `export const AUDIT_LOG_PAGE_SIZE = 50;` (FR-068's literal value — cite `prd.md:436` and `EXPERIENCE.md:1263`, not a mockup-derived guess like Subscriptions' 25).
  - [x] `const AUDIT_LOG_EXPORT_ROW_LIMIT = 1000;` (own per-file copy, matching `members.ts:13`/`subscriptions.ts:209`'s identical constants — AC #4's extrapolated cap).
  - [x] Define `AuditLogRow` (camelCase UI type: `id`, `actorId`, `actorDisplayName`, `actionType`, `targetEntityId`, `targetEntityType`, `metadata`, `createdAt`) + a private snake_case `AuditLogRowFromDb` + a `toAuditLogRow()` mapper, mirroring `subscriptions.ts:211-250`'s shape. Source columns: `audit_log`'s actual schema (`supabase/migrations/0007_audit_log.sql:15-55`).
  - [x] `applyAuditLogFilters(query, params)`: chain `.gte("created_at", dateStartIso(from)).lt("created_at", dateEndExclusiveIso(to))` and, if `actorId` is present, `.eq("actor_id", actorId)` — same defensive-against-hand-edited-params discipline as `subscriptions.ts:255-257`.
  - [x] `listAuditLog(params: { from?, to?, actorId?, page? })`: mirror `subscriptions.ts:291-332`'s `listSubscriptions` shape exactly — `getCallerGymId`, offset math (`from = (page-1)*AUDIT_LOG_PAGE_SIZE`), `.select("*", { count: "exact" }).eq("gym_id", gymId)` (defense-in-depth even though RLS from Task 1 already scopes this — every service function in this codebase double-checks, per `subscriptions.ts:288-290`'s own comment), `applyAuditLogFilters`, `.order("created_at", { ascending: false })`, `.range(from, to)`. No sortable columns — AD-12 specifies fixed newest-first order only, unlike Subscriptions' sortable table.
  - [x] `listAuditActors()`: no exact precedent for a "distinct values for a filter dropdown" query exists in this codebase. Implement via a capped client-side de-dup (`.select("actor_id, actor_display_name").eq("gym_id", gymId).not("actor_id", "is", null).limit(500)`, then dedupe into a `Map` keyed by `actor_id`) rather than introducing a new SQL RPC function — simpler and consistent with this codebase's preference for avoiding new SQL functions unless a write path needs `SECURITY DEFINER`.
  - [x] **Target display — explicit scope decision, do not deviate**: `EXPERIENCE.md`'s AD-12 mockup shows a resolved name in the Target column ("Amara K."), but `target_entity_id` is deliberately **not** a foreign key (`0007_audit_log.sql:48` — "the log must survive even if the target row is later deleted"), and neither FR-080 nor FR-081's literal text requires a resolved display name (FR-080 only requires capturing "target entity ID"). Live-joining per `target_entity_type` (member vs. payment vs. coach_assignment vs. job_runs...) would show *current* state, not historical fact — the same problem `actor_display_name`'s write-time denormalization was designed to avoid (`0007_audit_log.sql`'s own comment). **Render `target_entity_type` + raw `target_entity_id`** (e.g. `member · a1b2c3d4…`, truncated), not a resolved name. Treat AD-12's "Amara K." as illustrative mockup polish, not a literal binding requirement. *(rendering itself implemented in Task 3's `AuditLogPageClient.tsx`)*
  - [x] **Actor display — same scope decision, applied the same way**: AD-12's Components list says the Actor column shows "display name + role," but `audit_log` stores only `actor_display_name` (denormalized at write time, `0007_audit_log.sql`'s own comment: "must survive even if the users row's display_name later changes") — there is no stored `actor_role` column, and a live join to `users`/`members` for the actor's *current* role would reintroduce the exact same stale-data problem the target-display decision above rejects, plus it would misrepresent history for an actor whose role changed since the logged action. **Render `actor_display_name` only** — for system/cron actors this is already a self-describing label (`"system:<job_name>"`, per `log_audit_event()`'s fallback, `0007_audit_log.sql:200-204`). Do not add a role lookup/join for this column. *(rendering itself implemented in Task 3)*
  - [x] **Details column**: render `metadata` (jsonb) as a comma-separated `key: value` list (e.g. `amount: 15000, method: cash`), skipping the column entirely (render `—`) when `metadata` is `{}` (`0007_audit_log.sql:53`'s default). No JSON pretty-printing or nested-object handling is needed — every `metadata` shape produced by the 12 known write call sites (Task 2's `AUDIT_ACTION_TYPE_LABEL_KEY` list) is a flat, single-level object (confirmed via Story 7.1's coverage matrix and the `jsonb_build_object(...)` call shapes cited in `docs/decisions.md`'s 2026-08-04 entry). *(rendering itself implemented in Task 3)*
  - [x] **Action label map**: create `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` following the exact `Record<string, string>` shape of `PAYMENT_METHOD_LABEL_KEY` (`apps/dashboard/app/(dashboard)/payments/paymentLabels.ts:30-34`) — an `AUDIT_ACTION_TYPE_LABEL_KEY: Record<string, string>` mapping every known `action_type` value to an `audit.actionTypes.*` i18n key. The complete list of 12 values that exist in this codebase today (from Story 7.1's coverage matrix, `docs/decisions.md`'s 2026-08-04 "Audit Record Coverage Verification" entry): `manual_payment_recorded`, `payment_verified`, `payment_flagged`, `payment_verification_failed`, `refund_recorded`, `member_deactivated`, `coach_assigned`, `coach_reassigned`, `gym_data_escalation`, `subscription_lifecycle_job_failure`, `check_in_auto_timeout_job_failure`, `payment_reconciliation_job_failure`. An `action_type` not in the map should fall back to rendering the raw string (defensive, since `action_type` is free text, not an enum — `0007_audit_log.sql`'s own comment explains why).
  - [x] `exportAuditLogCsv(params)`: mirror `exportSubscriptionsCsv` (`subscriptions.ts:354-419`) exactly — count-then-data two-query shape, `export_too_large` error if `count > AUDIT_LOG_EXPORT_ROW_LIMIT` (reuse the exact locale string `"Apply a filter to narrow results"`, same key convention `audit.errors.exportTooLarge`), `csvEscape()` on every field, `\r\n`-joined rows. **Before any of that**, as the very first check inside the function: read `role` from `getCallerGymId`'s extended return, and if `role !== "owner"`, return `{ data: null, error: { code: "forbidden", message: t("audit.errors.exportOwnerOnly") } }` — check `packages/types/src/errors.ts` first for an existing `forbidden`/`permission_denied`-style `AppError` code to reuse before inventing a new string. *(no existing code found; used new `"forbidden"` code)*

- [x] **Task 3: Build the route — page, loading skeleton, client component** (AC #1, #2)
  - [x] `apps/dashboard/app/(dashboard)/audit/page.tsx`: Server Component reading `searchParams: Promise<{ from?, to?, actorId?, page? }>`, wrapped in `<Suspense fallback={<AuditLoading />}>`, mirroring `subscriptions/page.tsx:36-82`'s exact shape (parse+validate `page`, call `listAuditLog` and `listAuditActors` in parallel via `Promise.all`, plus `getDashboardShellContext()` for `role` — mirror `payments/page.tsx:53`'s `role={shell.role}` pass-through). Copy `subscriptions/page.tsx:9-35`'s doctrine comment verbatim (adapted): "No route-level role guard beyond `(dashboard)/layout.tsx`'s gym-scoped-staff gate — the Sidebar's `NAV_ITEMS` already restricts this link to `manager`/`owner`, but that's UI-only; the real enforcement is Task 1's `manager_or_owner_read_own_audit_log` RLS policy. A Receptionist/Coach reaching `/audit` directly gets zero rows, not a 403."
  - [x] `apps/dashboard/app/(dashboard)/audit/loading.tsx`: static skeleton, copy `subscriptions/loading.tsx`'s shape (title bar + ~8-10 pulsing row placeholders — the skeleton row count does not need to match the real 50/page size, no sibling loading.tsx does).
  - [x] `apps/dashboard/app/(dashboard)/audit/components/AuditLogPageClient.tsx`: mirror `SubscriptionsPageClient.tsx`'s prop shape (`initialRows`, `total`, `page`, `pageSize`, current filter values `from`/`to`/`actorId`, plus new `role: MemberRole` and `actorOptions: AuditActorOption[]` props) and its `updateParams()`/`router.push()` URL-mutation pattern (`SubscriptionsPageClient.tsx:103-123`). **Do not use TanStack Query** — despite `architecture.md`'s general framing of it for "interactive pieces," its only real consumer in this codebase is `FrontDeskAlertPanel.tsx`'s Realtime-polling use case; every filtered/paginated table (Members, Subscriptions, Payments, Attendance) uses Server Component fetch + URL params + `router.push`, with zero client-side re-fetching library. Follow that established pattern exactly.
    - [x] Date filters: two native `<input type="date">` elements, copying `AttendancePageClient.tsx:298-325`'s exact shape including its `e.target.value || from` defensive fallback (clearing a native date input emits `""`, not `undefined`).
    - [x] Actor filter: a `<select>` populated from `actorOptions`, following `SubscriptionsPageClient.tsx:187-200`'s dropdown-filter pattern (`onChange` → `updateParams({ actorId: e.target.value, page: 1 })`).
    - [x] Table row rendering: no `onClick`/hover-affordance styling implying editability, no context menu, no checkbox column, no action-buttons column at all (AC #1's read-only enforcement — the only interactive elements on this entire page are the two filters, the pager, and the Owner-only export button).
    - [x] Pager: copy the `pageWindow()` helper per-file from `SubscriptionsPageClient.tsx:34-58` (this codebase's established per-file-copy discipline for this helper, not a shared import).
    - [x] Export button (AC #4): `{role === "owner" && <Button onClick={handleExport} disabled={exporting}>{t("audit.export.button")}</Button>}`, mirroring `SubscriptionsPageClient.tsx:139-163`'s `handleExport`/Blob-download/toast-on-error pattern. This exact single-role predicate (`role === "owner"`, not `role === "owner" || role === "manager"`) has no prior instance in this codebase — the closest precedent is `PaymentsPageClient.tsx:101`'s two-role check; adapt, don't copy that one directly.
    - [x] Empty state: render `t("audit.emptyNoRecords")` ("No audit records for this period.") when `rows.length === 0`, regardless of whether a filter is active (AD-12 has only one empty-state message, unlike Members/Subscriptions' two-message no-data-vs-no-match distinction).

- [x] **Task 4: Add the Server Action wrapper for CSV export** (AC #4)
  - [x] Create `apps/dashboard/app/(dashboard)/audit/actions.ts` (a `"use server"` file) — this is a deliberate, documented deviation from `architecture.md:331`'s stale "no actions.ts" comment for this route, which predates the Owner-only export requirement. Note the deviation in this story's Dev Notes/Change Log, matching this codebase's standing convention for documenting architecture deviations (e.g. `0009_auth_hook_gym_claims.sql`'s `auth.gym_id()` → `private.gym_id()` deviation note).
  - [x] One thin passthrough function, mirroring `subscriptions/actions.ts:50-59`'s `exportSubscriptionsCsvAction`:
    ```ts
    export async function exportAuditLogCsvAction(params: {
      from?: string; to?: string; actorId?: string;
    }) {
      return exportAuditLogCsv(params);
    }
    ```
    All real logic (including the Owner-only role check) lives in `exportAuditLogCsv` (Task 2) — this file is a pure passthrough, same as every sibling `actions.ts` export wrapper.

- [x] **Task 5: Add `audit.*` locale strings** (AC #1, #2, #4)
  - [x] Add a new top-level `audit` key to **both** `apps/dashboard/locales/en.json` and `apps/dashboard/locales/fr.json` (the real location for feature-scoped dashboard strings — not `packages/types/src/locales/`, which holds only the cross-app-shared `common`/`errors`/`auth` namespaces, merged at runtime via `deepMerge` in `apps/dashboard/lib/i18n/get-server-translation.ts:16-41`). `nav.auditLog` already exists in both files — do not re-add it.
  - [ ] Mirror `subscriptions.*`'s exact skeleton shape (`apps/dashboard/locales/en.json`, `subscriptions` key): `audit.title` = "Audit Log"; `audit.table.{timestamp,actor,action,target,details}`; `audit.filters.{dateFrom,dateTo,actor,actorAll}` — reuse the exact `dateFrom`/`dateTo` key names already present under this file's `attendance` namespace, don't invent different wording; `audit.emptyNoRecords` = "No audit records for this period." (AD-12's exact copy, `EXPERIENCE.md:1278`); `audit.pagination.{previous,next,ellipsis}` (copy `subscriptions.pagination`'s values verbatim); `audit.export.{button,exporting}` (copy `subscriptions.export`'s values verbatim: "Export CSV" / "Exporting…"); `audit.errors.{exportTooLarge,exportOwnerOnly}` — `exportTooLarge` reuses the exact string "Apply a filter to narrow results" (`subscriptions.errors.exportTooLarge`'s value); `exportOwnerOnly` is new copy for the server-side rejection case (unreachable via normal UI since the button is hidden, but must exist for the mapped error message).
  - [x] `audit.actionTypes.*`: one key per `AUDIT_ACTION_TYPE_LABEL_KEY` entry from Task 2 (12 keys), in both English and French. Suggested EN values (French needs equivalent translation, follow this file's existing tone for other domains): `manualPaymentRecorded` = "Payment entry", `paymentVerified` = "Payment verified", `paymentFlagged` = "Payment flagged", `paymentVerificationFailed` = "Payment verification failed", `refundRecorded` = "Refund recorded", `memberDeactivated` = "Member deactivated", `coachAssigned` = "Coach assigned", `coachReassigned` = "Coach reassigned", `gymDataEscalation` = "Gym data access", `subscriptionLifecycleJobFailure` = "Subscription job failure", `checkInAutoTimeoutJobFailure` = "Check-in job failure", `paymentReconciliationJobFailure` = "Payment reconciliation job failure".

- [x] **Task 6: Confirm the Sidebar nav entry — no code change expected** (AC #1)
  - [x] `apps/dashboard/components/shared/Sidebar.tsx:42` already has `{ labelKey: "nav.auditLog", href: "/audit", icon: ScrollText, roles: ["manager", "owner"] }`, pre-added during Story 1.9/1.10 as a forward-looking placeholder (confirmed via `git log -p -S "nav.auditLog"`). Verify it still matches this exact shape and links correctly to the new route once Task 3 lands — do not duplicate or re-add this entry.

- [x] **Task 7: Validate and finalize**
  - [x] Run `supabase db reset` then `supabase test db` **from WSL, not native PowerShell** (this machine's Supabase CLI/Docker setup only works from WSL — a standing environment fact, not specific to this story) — confirm all migrations apply cleanly (including the still-uncommitted `0048` from Story 7.1 and this story's new `0049`) and the full pgTAP suite passes, including the new `audit_log_manager_owner_read.test.sql` assertions. *(848/848 passing; also required updating one pre-existing test, see Task 1's Debug Log entry)*
  - [x] Run `supabase gen types typescript --local` (WSL) and diff against committed `packages/types/src/database.ts` — this migration only adds an RLS policy, no table/column/function-signature changes, so expect an empty or line-ending-only diff. *(diff was empty)*
  - [x] Run `pnpm run typecheck` and `pnpm run lint` (native Windows) across the monorepo — confirm no new errors. Pre-existing, unrelated gaps to expect unchanged (per Story 7.1's Debug Log): `apps/mobile` lint fails with "eslint not recognized" (missing local binary, known env gap); `apps/dashboard` has 4 pre-existing `react-hooks/set-state-in-effect`/`i18next/no-literal-string` errors in `RecordRefundModal.tsx`/`RenewalModal.tsx`; `apps/super-admin` has 1 pre-existing `react-hooks/exhaustive-deps` warning in `PaymentProvidersPageClient.tsx`. *(typecheck: 0 errors across all 4 packages; lint: exactly the documented pre-existing gaps, nothing new)*
  - [x] Manually verify in a running dashboard session (Owner and Manager claims) that: the page loads at `/audit`, filters and pagination work, the empty state renders correctly for an out-of-range date filter, and the Export CSV button is visible only for the Owner session. *(verified via browser against a locally seeded Owner/Manager gym: table renders with correct action labels/target/details formatting, actor dropdown populated, date-filter empty state shows the exact AD-12 copy, Export CSV visible only for Owner and downloads without error, Manager session confirmed to have the button hidden while still seeing the same rows)*

### Review Findings

- [x] [Review][Defer] No automated test for the Owner-only CSV export server-side authorization gate (AC #4) — `exportAuditLogCsv`'s `role !== "owner"` check (`apps/dashboard/services/auditLog.ts:255`) is the one piece of access control in this feature RLS does not enforce (0049's policy is deliberately not role-split between Manager/Owner), verified only by a manual browser check recorded in the Dev Agent Record. No test runner (Vitest/Jest) exists anywhere in this repo yet — deferred, pre-existing convention: manual verification is sufficient for now, matching the codebase's established service-layer testing convention (pgTAP + typecheck + manual); setting up test infra is a separate future decision.

- [x] [Review][Patch] Date filters accept `from > to` with no validation, silently returning an empty result set indistinguishable from a genuinely empty period [apps/dashboard/services/auditLog.ts:140-148] — fixed via new `resolveAuditDateRange()` helper, which swaps an inverted range.
- [x] [Review][Patch] `detailsLabel()` renders metadata values via `String(value)` with no guard for non-primitive values, risking a silent `"[object Object]"` in the UI if the flat-metadata assumption is ever violated [apps/dashboard/app/(dashboard)/audit/components/AuditLogPageClient.tsx:56-60] — fixed with a `typeof === "object"` guard falling back to `JSON.stringify`.
- [x] [Review][Patch] `listAuditActors()` calls `.limit(500)` with no `.order()` first, risking nondeterministic truncation of the actor filter dropdown [apps/dashboard/services/auditLog.ts:212-217] — fixed, added `.order("created_at", { ascending: false })` before `.limit(500)`.
- [x] [Review][Patch] pgTAP test 6 (super_admin regression guard) reuses Gym A owner's UUID instead of the dedicated Super Admin fixture row inserted for that purpose — dead fixture data and a weaker-than-intended regression guard [supabase/tests/audit_log_manager_owner_read.test.sql:21-27,139-150] — fixed, test now uses `...014026`. Full pgTAP suite re-verified: 848/848 passing.
- [x] [Review][Patch] Migration comment states "`null = null` is falsy in SQL," which is technically incorrect (evaluates to `UNKNOWN`, not `FALSE`) — functional behavior is correct, but the stated reasoning is wrong [supabase/migrations/0049_audit_log_dashboard_read_policy.sql:17] — comment corrected.
- [x] [Review][Patch] `page.tsx` passes raw, unvalidated `from`/`to` query params to the client component instead of the resolved values actually used by the query, so a malformed date in the URL makes the date-picker widget show a value that doesn't match what was queried [apps/dashboard/app/(dashboard)/audit/page.tsx:73-74] — fixed, now uses the same `resolveAuditDateRange()` result for both the query and the client props.
- [x] [Review][Patch] `todayUtcDate()` is exported from `auditLog.ts` but never called anywhere in this diff — dead code [apps/dashboard/services/auditLog.ts:53-55] — removed.

- [x] [Review][Defer] Export count-then-fetch has a TOCTOU race window between the count check and the data fetch [apps/dashboard/services/auditLog.ts:263-281] — deferred, pre-existing (mirrors exportSubscriptionsCsv's identical pattern)
- [x] [Review][Defer] `total: count ?? 0` silently treats a null count as zero [apps/dashboard/services/auditLog.ts:189] — deferred, pre-existing (identical to subscriptions.ts)
- [x] [Review][Defer] Page-number query param is not clamped to `totalPages` [apps/dashboard/app/(dashboard)/audit/page.tsx:40-41] — deferred, pre-existing (identical unclamped pattern in subscriptions/page.tsx)
- [x] [Review][Defer] `Promise.all` over 3 service calls has no try/catch [apps/dashboard/app/(dashboard)/audit/page.tsx:44-52] — deferred, pre-existing (identical to payments/page.tsx's precedent)
- [x] [Review][Defer] `csvEscape()` doesn't guard leading tab/CR characters against CSV formula injection [apps/dashboard/services/auditLog.ts:42-48] — deferred, pre-existing (inherited unchanged from subscriptions.ts/members.ts)
- [x] [Review][Defer] `getCallerGymId`'s missing-claim failure always returns the generic `not_found` code [apps/dashboard/services/auditLog.ts:34] — deferred, pre-existing (copied verbatim from subscriptions.ts)
- [x] [Review][Defer] `actorId` filter param has no UUID-format validation before `.eq()` [apps/dashboard/services/auditLog.ts:140-148] — deferred, pre-existing pattern; already fails safe via the existing query-error path, not a crash risk

## Dev Notes

### Scope and Non-Negotiable Decisions

- **This story is the one that closes the audit_log RLS gap both `0007_audit_log.sql` and `0012_super_admin_data_access_escalation.sql` explicitly deferred to it** — do not treat the new `manager_or_owner_read_own_audit_log` policy as optional or as scope creep; without it, AC #1/#2 cannot return any rows for a Manager/Owner session (the table has been deny-all for gym staff since Story 1.4).
- **The Sidebar nav entry and its `nav.auditLog` label already exist** (Task 6) — this is the one piece of this story that was pre-built by an earlier story. Do not re-implement it; a missing `/audit` route behind an already-live nav link is the actual current-state bug this story fixes.
- **Do not resolve `target_entity_id` to a live-joined display name** (see Task 2's explicit scope decision) — render `target_entity_type` + raw ID. The `EXPERIENCE.md` mockup's "Amara K." is illustrative, not literal; the schema's own design (`target_entity_id` deliberately not an FK) argues against a live join.
- **Do not use TanStack Query for this table** — despite `architecture.md`'s general framing, every actual filtered/paginated table in this codebase (Members, Subscriptions, Payments, Attendance) is Server Component + URL search params + `router.push`, with TanStack Query used nowhere except `FrontDeskAlertPanel.tsx`'s Realtime-polling case. Introducing it here would be an unprecedented deviation.
- **The Owner-only CSV export gate has no prior exact precedent in this codebase** (`PaymentsPageClient.tsx:101`'s `role === "owner" || role === "manager"` is the closest, but it's the *wrong* shape — two roles, not one). Both the client-side hide (`role === "owner"`) and a genuine server-side check inside `exportAuditLogCsv` (rejecting a Manager session even via a direct action call) are required — RLS cannot enforce this distinction on its own, since Manager and Owner share identical read access to the underlying rows (Task 1's policy is deliberately not role-split at the RLS layer — only the export path is Owner-only, per AD-12/FR-081).
- **1,000-row CSV export cap is an extrapolation, not a literal FR requirement** — FR-081 sets no explicit ceiling, unlike FR-066/FR-085's explicit "1,000 rows" text. Applying the same cap keeps this story consistent with every other CSV export in the codebase (Members, Subscriptions) rather than leaving Audit Log as the one unbounded export; flagged here so a reviewer doesn't mistake it for a literal, sourced requirement.
- **`services/auditLog.ts` (not `audit.ts`) and a new `audit/actions.ts` (deviating from `architecture.md`'s stale "no actions.ts" note)** — both intentional corrections to `architecture.md`'s file-tree sketch, which predates the Owner-only export requirement that necessitates a Server Action. Record both in this story's Change Log once implemented, matching this codebase's standing practice of documenting architecture deviations inline rather than silently diverging.

### Architecture and Testing Guardrails

- `private.gym_id()` (`supabase/migrations/0009_auth_hook_gym_claims.sql:20-43`) is the tenant-scoping primitive every RLS policy in this project calls — use it, not a raw `auth.jwt() ->> 'gym_id'` inline expression.
- `log_audit_event()` (`0007_audit_log.sql:151-219`) is unrelated to this story's scope — this story only adds a **read** policy; no new writes, no changes to the write path Story 1.4/7.1 already built.
- Every service function in this codebase re-applies `.eq("gym_id", gymId)` even where RLS already scopes the query (defense-in-depth, `subscriptions.ts:288-290`'s own stated discipline) — follow it here too, don't rely on RLS alone.
- `csvEscape()`, page-size/export-cap constants, and the `pageWindow()` pager helper are all copied per-file across this codebase's list pages (Members, Subscriptions) rather than imported from a shared module — an established, deliberate discipline, not an oversight to "fix" by extracting a shared utility.
- WSL is required for all `supabase` CLI commands on this machine (Docker/Supabase do not run correctly from native PowerShell here) — a standing environment constraint, not specific to this story.

### Project Structure Notes

- New migration: `supabase/migrations/0049_audit_log_dashboard_read_policy.sql` (one RLS policy only).
- New test: `supabase/tests/audit_log_manager_owner_read.test.sql`.
- New: `apps/dashboard/services/auditLog.ts`.
- New: `apps/dashboard/app/(dashboard)/audit/page.tsx`, `loading.tsx`, `actions.ts`, `auditLabels.ts`, `components/AuditLogPageClient.tsx`.
- Edited: `apps/dashboard/locales/en.json`, `apps/dashboard/locales/fr.json` (new `audit` top-level key only; `nav.auditLog` already present, untouched).
- No changes to `apps/dashboard/components/shared/Sidebar.tsx` (already correct), `apps/mobile`, `apps/super-admin`, `packages/types/src/database.ts` (expected empty diff), or any existing migration file.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md:1253-1271` — Epic 7, Story 7.2 (AC text)]
- [Source: `_bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:417-426,436,510-514` — FR-064 role table, FR-068, FR-079/080/081 exact wording]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:1248-1279` — AD-12 Audit Log full spec: layout, components, columns, empty state]
- [Source: `_bmad-output/planning-artifacts/architecture.md:331,342,469` — file-tree sketch (superseded in part, see Dev Notes), FR-Category-to-structure mapping]
- [Source: `supabase/migrations/0007_audit_log.sql` — `audit_log` schema, existing indexes, deny-all RLS since creation]
- [Source: `supabase/migrations/0012_super_admin_data_access_escalation.sql:8-21,66` — existing `super_admin_read_audit_log` policy this story's new policy coexists with, composite index]
- [Source: `supabase/migrations/0039_coach_member_assignment.sql:49-57`, `0041_coach_portal_member_detail_session_notes.sql:70-75` — exact RLS policy template (`manager_or_owner_read_own_*`)]
- [Source: `supabase/migrations/0009_auth_hook_gym_claims.sql:20-43` — `private.gym_id()` definition]
- [Source: `supabase/tests/coach_member_assignment.test.sql:245-275` — pgTAP assertion template for a Manager/Owner-scoped SELECT policy]
- [Source: `apps/dashboard/app/(dashboard)/subscriptions/page.tsx`, `subscriptions/actions.ts`, `subscriptions/components/SubscriptionsPageClient.tsx`, `subscriptions/loading.tsx` — primary sibling-page template]
- [Source: `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx:39,101` — `role` prop pass-through, closest (but two-role) precedent for role-gated UI]
- [Source: `apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx:298-325` — native date-range filter template]
- [Source: `apps/dashboard/services/subscriptions.ts:209,211-250,252-342,354-419` — service-layer conventions: constants, row types, filters, `csvEscape`, export shape]
- [Source: `apps/dashboard/services/attendance.ts:51-83` — date-boundary helpers (`todayUtcDate`, `dateStartIso`, `dateEndExclusiveIso`, `isValidDateString`, `resolveDateParam`)]
- [Source: `apps/dashboard/services/session.ts:22-28,35,97` — `mapAndLog`, `MemberRole` type, claims-derived role read]
- [Source: `apps/dashboard/services/members.ts:13,750-826` — `exportMembersCsv`, 1,000-row export ceiling precedent]
- [Source: `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts:30-34` — `Record<string,string>` label-map convention for `auditLabels.ts`]
- [Source: `apps/dashboard/components/shared/Sidebar.tsx:30-45,77` — `NAV_ITEMS`, already includes the `/audit` entry]
- [Source: `apps/dashboard/locales/en.json` (`subscriptions`, `attendance`, `nav` keys), `apps/dashboard/lib/i18n/get-server-translation.ts:16-41` — real locale-file location and `deepMerge` convention (corrects `architecture.md`'s stated shared-locale-package plan)]
- [Source: `_bmad-output/implementation-artifacts/7-1-audit-record-coverage-verification.md` — previous story in this epic: full FR-080 action-type coverage matrix, testing/validation command sequence]
- [Source: `docs/decisions.md`, 2026-08-04 "Audit Record Coverage Verification" entry — the 12 known `action_type` values this story's `auditLabels.ts` must cover]
- [Source: memory `project_supabase_wsl.md` — Supabase CLI/Docker on this machine must run from WSL, not native PowerShell]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase test db` initially failed 1/848 on `gym_data_escalation_rls.test.sql` test 9, which had asserted the pre-7.2 deny-all state for a gym-scoped owner session ("this story's read policy is Super-Admin-only, not a general gym-admin grant"). This was Story 1.7's own documented placeholder for Story 7.2's not-yet-built policy — updated the assertion (owner now sees the row, count 0 → 1) and its comment to reflect the new, correct, coexisting-OR'd-policies behavior. Full suite passes 848/848 after the fix.

### Completion Notes List

- Task 1: Added `manager_or_owner_read_own_audit_log` RLS policy (migration 0049) and its pgTAP coverage (`audit_log_manager_owner_read.test.sql`, 6 assertions). Updated one pre-existing test (`gym_data_escalation_rls.test.sql`) whose assertion encoded the pre-7.2 deny-all state that this story intentionally changes. `supabase db reset` + `supabase test db` both pass (848/848) via WSL.
- Task 2: Built `apps/dashboard/services/auditLog.ts` (per-file-copy `getCallerGymId`+role, date helpers, `listAuditLog`, `listAuditActors`, `exportAuditLogCsv` with the Owner-only server-side gate) and `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` (12-entry action-type label map). No existing `forbidden`/`permission_denied` `AppError` code existed in `packages/types/src/errors.ts`, so introduced a new `"forbidden"` code for the export gate.
- Task 3: Built the route — `page.tsx` (Server Component, `Promise.all` of `listAuditLog`/`listAuditActors`/`getDashboardShellContext`), `loading.tsx` skeleton, and `components/AuditLogPageClient.tsx` (date-range + actor filters, fixed newest-first read-only table, per-file `pageWindow()` pager, Owner-only Export CSV button with Blob-download/toast pattern).
- Task 4: Added `audit/actions.ts` — one thin `exportAuditLogCsvAction` passthrough, deliberately deviating from `architecture.md`'s stale "no actions.ts" note for this route (documented here per this codebase's standing convention).
- Task 5: Added the `audit` top-level key to both `apps/dashboard/locales/en.json` and `fr.json` (table/filters/pagination/export/errors/12 actionTypes). Both files validated as parseable JSON.
- Task 6: Confirmed `Sidebar.tsx:42`'s pre-existing `nav.auditLog` entry already matches the expected shape — no change made.
- Task 7: `supabase gen types typescript --local` diffed empty against the committed `database.ts`. `pnpm run typecheck` passed with 0 errors across all 4 packages. `pnpm run lint` reproduced exactly the three pre-existing, documented gaps (mobile's missing local eslint binary, dashboard's 4 `RecordRefundModal.tsx`/`RenewalModal.tsx` findings, super-admin's 1 `PaymentProvidersPageClient.tsx` warning) with nothing new. Manually verified end-to-end via browser against a locally seeded Owner+Manager gym (throwaway seed script, not committed; DB reset afterward to clear it): table renders seeded rows with correct action labels/target-truncation/details formatting, actor dropdown populated from real data, date-filter empty state shows AD-12's exact copy, Export CSV is visible and functions for the Owner session and confirmed hidden for the Manager session (which still sees the same rows, per the coexisting policy design).

### File List

- `supabase/migrations/0049_audit_log_dashboard_read_policy.sql` (new)
- `supabase/tests/audit_log_manager_owner_read.test.sql` (new)
- `supabase/tests/gym_data_escalation_rls.test.sql` (edited — updated pre-7.2 assertion)
- `apps/dashboard/services/auditLog.ts` (new)
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` (new)
- `apps/dashboard/app/(dashboard)/audit/page.tsx` (new)
- `apps/dashboard/app/(dashboard)/audit/loading.tsx` (new)
- `apps/dashboard/app/(dashboard)/audit/actions.ts` (new)
- `apps/dashboard/app/(dashboard)/audit/components/AuditLogPageClient.tsx` (new)
- `apps/dashboard/locales/en.json` (edited — added `audit` key)
- `apps/dashboard/locales/fr.json` (edited — added `audit` key)

## Change Log

| Date | Change |
|---|---|
| 2026-08-04 | Story context created via create-story workflow. |
| 2026-08-05 | Implemented all 7 tasks: `manager_or_owner_read_own_audit_log` RLS policy + pgTAP coverage (migration 0049), `auditLog.ts` service layer, the `/audit` route (page/loading/client component), `audit/actions.ts` Server Action wrapper (documented deviation from `architecture.md`'s stale "no actions.ts" note), `audit.*` locale strings, and full validation (848/848 pgTAP, clean typecheck, no new lint errors, manual browser verification). Story moved to `review`. |
| 2026-08-05 | Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): 7 patches applied (inverted date-range validation, non-primitive metadata guard, actor-list ordering, pgTAP test-6 fixture UUID, migration comment correction, page.tsx date-range consistency, dead-code removal); export-authz automated-test coverage deferred (no test runner exists in this repo yet — manual verification accepted); 7 other findings deferred as pre-existing/established-convention issues; 7 dismissed as matching documented precedent or out of spec scope. Re-verified: 848/848 pgTAP, clean typecheck across all 4 packages. Story moved to `done`. |
