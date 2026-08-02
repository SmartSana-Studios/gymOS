---
baseline_commit: e4619de
---

# Story 5.2: Coach Portal — Assigned Member List

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Coach,
I want to see only my assigned members,
so that my portal reflects exactly my caseload.

## Scope Notes — Read Before the Acceptance Criteria

**This story builds the first real page under `/coach` — AD-14 in the UX spec. No route exists yet.** Story 5.1 explicitly deferred it: "The actual `/coach` route (Coach Portal pages) is Story 5.2/5.3 — do not build it here." The Sidebar's `/coach` nav entry (gated to `roles: ["coach"]`) has existed since Story 1.8 and needs no changes. `architecture.md`'s directory listing puts this story's page at `apps/dashboard/app/(dashboard)/coach/page.tsx` (AD-14); the member-detail route `coach/[memberId]/page.tsx` (AD-15) and its `actions.ts` (`addSessionNote`) belong to Story 5.3 — do not build them here.

**The hard technical problem in this story is AC #3's RLS narrowing, not the UI.** `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` (`0018_member_management.sql`) currently grant `'coach'` the same gym-wide read access as Receptionist — Story 5.1's own Scope Notes flagged this as "a known, temporary over-broadening... revisit when Epic 5 ships Coach logins," and explicitly assigned that revisit to this story. Narrowing it is not optional cleanup — AC #3 requires it directly ("RLS blocks the query... I can only ever see members assigned to me").

**Do not write the coach-scoping check as a plain correlated subquery inside the new RLS policies.** The naive approach —
```sql
create policy "coach_read_assigned_members" on members for select using (
  exists (select 1 from coach_assignments ca join members coach_m on coach_m.id = ca.coach_id
          where ca.member_id = members.id and ca.ended_at is null and coach_m.user_id = auth.uid())
);
```
— silently returns **zero rows for every coach, always**, because the subquery's `coach_assignments`/`members` reads are themselves evaluated under RLS for the calling (coach) session. `coach_assignments` currently has exactly one SELECT policy (`manager_or_owner_read_own_coach_assignments`, Story 5.1), scoped to `manager`/`owner` only — a coach session has **no** SELECT policy granting it any row on `coach_assignments`, so the subquery's own read of that table returns nothing regardless of whether a real assignment exists, and `exists(...)` evaluates false every time. Same problem hits the nested `members coach_m` read once `gym_staff_read_own_members` is narrowed to exclude `coach` (below) — a coach reading their own row via a bare subquery has no self-read policy to fall back on. This is a correctness bug, not a performance one — it wouldn't throw an error, it would just make the entire feature silently show an empty list for every coach, and pgTAP tests naively written against a service-role or superuser session (which bypasses RLS) would not catch it.

**The fix: a `SECURITY DEFINER` STABLE helper, `private.is_assigned_coach(p_member_id uuid)`, that runs with the function owner's privileges (bypassing RLS on `coach_assignments`/`members` for its own internal lookup only) — the same mechanism this codebase already uses for the opposite problem in Story 1.3's `custom_access_token_hook()` (`docs/decisions.md`'s "Also caught during this story" entry, 2026-07-06): a function whose own internal reads are subject to deny-all RLS for the role it runs as, fixed by making it `SECURITY DEFINER` so it runs as the (RLS-bypassing) function owner instead.** This is a genuine deviation from `private.gym_id()`/`private.is_super_admin()`'s existing shape — both of those are plain `STABLE` (no `SECURITY DEFINER`) because they only read the JWT via `auth.jwt()`, never a table. `private.is_assigned_coach()` is the first `private`-schema helper that reads a table, so it needs the additional privilege escalation those two didn't. Record this as a `docs/decisions.md` entry (Task 8) — the same "why this differs from the existing precedent" discipline Story 1.3's region/claims decisions and Story 5.1's grant-shape decision both followed.

**`private.is_assigned_coach()` is a `private`-schema helper used *inside* RLS policies — it is not a client-callable RPC.** Unlike `assign_coach()` (Story 5.1, `SECURITY DEFINER`, called directly via `supabase.rpc(...)`), this function is only ever invoked from within a `USING` clause, the same relationship `private.gym_id()` has to every RLS policy that calls it. Still `revoke execute ... from public; grant execute ... to authenticated;` explicitly (Task 1) rather than relying on `private` schema's `usage`-level gate alone (`private.gym_id()`/`private.is_super_admin()`'s lighter-touch precedent) — because this one is `SECURITY DEFINER` and bypasses RLS internally, an accidental broader grant is a bigger blast radius than a plain JWT-reading `STABLE` function, so it gets the same explicit revoke/grant discipline `assign_coach()` already uses for the same reason.

**`gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` are narrowed via `ALTER POLICY ... USING (...)`, not drop+recreate** — Postgres supports altering a policy's `USING` expression in place; no other property of either policy changes. Remove `'coach'` from both roles arrays. Two new, additive SELECT policies (`coach_read_assigned_members`, `coach_read_assigned_subscriptions`) give coach sessions their narrowed access via `private.is_assigned_coach()`. Same-table SELECT policies are OR'd (this codebase's own established behavior, documented on `gym_staff_read_own_members` itself and on the `gyms` table's two SELECT policies) — a coach session's `app_role = 'coach'` never satisfies the narrowed broad policy's role check, so the new narrow policy is the only one that ever contributes rows for a coach caller; no double-counting or interaction to worry about.

**Do not touch `coach_assignments`' own RLS (`manager_or_owner_read_own_coach_assignments`).** A coach still has no direct SELECT access to that table — `private.is_assigned_coach()` is the only path that reads it for a coach session, and it bypasses RLS internally by design (`SECURITY DEFINER`). No AC in this story asks for a coach-facing assignment-history view (that's Manager/Owner-only, Story 5.1 AC #3).

**Reuse the `subscriptions_current` view (Story 4.8, `0037_subscriptions_page_manual_renewal.sql`) instead of a new query shape.** It is `security_invoker = true` — meaning once the RLS narrowing above lands, a coach session querying `subscriptions_current` automatically gets rows scoped to exactly their assigned members, with **no additional app-side filter needed** (the view's own `members`/`subscriptions` joins are re-evaluated under the caller's RLS). It already resolves each member's *current* (most recent) subscription row including `status`/`plan_name`/`plan_type`/`expiry_date`/`member_name` — exactly the shape AC #2 needs, and it already includes `expired` members (no status filter in the view) which AC #2 explicitly requires stay visible. `.eq("gym_id", gymId)` stays in the new query as defense-in-depth, matching `listSubscriptions()`'s own established discipline of never relying on RLS alone even when RLS is the real enforcement.

**The AD-14 mockup (`EXPERIENCE.md` lines 1325–1349) shows more than AC #2's literal text ("sortable by name and plan").** It specifies a "Last note" column and a name-search box the AC doesn't mention. Resolve as follows, matching this codebase's own precedent for mockup/AC gaps (Story 4.8's "Last Payment column" cut, `docs/decisions.md`):
- **"Last note" column: cut.** `session_notes` doesn't exist until Story 5.3 — there is no data source for this column today, the same reasoning that cut the "Last Payment" column from the Subscriptions CSV export. Do not add a placeholder or an empty string column; simply don't render it.
- **Search by name: build it.** The mockup fully specifies it as an AD-14 component, and the global empty-state table (`EXPERIENCE.md` line 1700) defines its own dedicated empty-state copy ("No members match '[term]'." + a "Clear search" action) — this is a first-class part of the screen's designed behavior, not a stray mockup detail, and it's cheap to add given the sortable-table infrastructure this story already builds.
- **Sortable columns: union of AC #2 ("name and plan") and the mockup ("Name / Status / Expiry")** — wire up all four (name, plan, status, expiry) via the same click-to-sort header mechanism `SubscriptionsPageClient.tsx` already established. This satisfies both documents at effectively zero extra cost (one more `SORT_COLUMN_MAP` entry and header per column), rather than picking one document over the other.

**No pagination.** Neither AC #2 nor the AD-14 mockup calls for it (unlike Members/Subscriptions, which both have an explicit page-size spec). A coach's own caseload is a strict subset of a single gym's roster, which itself is pilot-scale (~30 members, NFR-009) — render the full sorted/filtered list in one page load, no `?page=` param, no `range()` call in the query.

**No route-level role guard beyond `(dashboard)/layout.tsx`'s existing gym-staff gate** — this app's established "Sidebar hides it, RLS is the real gate" precedent (`attendance/page.tsx`'s own comment, `subscriptions/page.tsx`'s own comment). A non-Coach session (Owner/Manager/Receptionist) reaching `/coach` directly is not blocked by this story; RLS/service-layer behavior for that case is a known, accepted, pre-existing-pattern gap, not something this story introduces or needs to close. (For a Manager/Owner specifically, `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` still include those roles after narrowing, so they'd see the *entire* gym roster on this page if they navigated here directly — same shape as the existing accepted gap on `/subscriptions`.)

**No `actions.ts` in this story.** This is a pure read (Server Component fetch, no form submission, no mutation) — `architecture.md`'s own file tree only assigns `coach/actions.ts` (`addSessionNote`) to the AD-15 detail route, which is Story 5.3's scope.

## Acceptance Criteria

1. **Given** I log in as a Coach, **when** the dashboard renders, **then** only the Coach Portal is accessible — Payments, Members, Settings, and Audit Log are absent from the DOM. [Source: epics.md#Story 5.2 AC#1; FR-053] (Note: already satisfied by Story 1.8's `Sidebar.tsx` `NAV_ITEMS` role-gating, unchanged since — this story adds no new sidebar behavior, just the page the existing `/coach` link now resolves to.)
2. **Given** my assigned member list, **when** I view it, **then** it's sortable by name and plan and shows each member's subscription status, including `expired` members (visible, not auto-notified). [Source: epics.md#Story 5.2 AC#2; FR-022, FR-054] (Note: no automated notification path exists in this codebase for any status — "not auto-notified" is satisfied by this story simply not adding one, consistent with Epic 6 owning all push-notification work.)
3. **Given** a member not assigned to me, **when** I attempt to access their profile directly (e.g., by URL) or search for them, **then** RLS blocks the query and they do not appear in my list or detail view — I can only ever see members assigned to me. [Source: epics.md#Story 5.2 AC#3; FR-022] (Note: "detail view" is AD-15/Story 5.3's route, not built here — this story's obligation is that the *list* and its *search* never surface an unassigned member, and that the RLS narrowing this story ships is what Story 5.3's detail route will also depend on.)
4. **Given** I have no assigned members, **when** I view the portal, **then** I see "No members have been assigned to you yet. Ask your manager to assign members." [Source: epics.md#Story 5.2 AC#4; UX EXPERIENCE.md line 1349]

## Tasks / Subtasks

- [x] **Task 1: Migration `0040_coach_portal_member_list_rls.sql`** (AC: #2, #3)
  - [x] `private.is_assigned_coach(p_member_id uuid)`: `SECURITY DEFINER` STABLE helper (Scope Notes — this is the story's core technical decision; read that section before writing this function):
    ```sql
    create function private.is_assigned_coach(p_member_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select exists (
        select 1
        from coach_assignments ca
        join members coach_m on coach_m.id = ca.coach_id
        where ca.member_id = p_member_id
          and ca.ended_at is null
          and coach_m.user_id = auth.uid()
          and coach_m.gym_id = private.gym_id()
      );
    $$;

    revoke execute on function private.is_assigned_coach from public;
    grant execute on function private.is_assigned_coach to authenticated;
    ```
  - [x] Narrow the two existing broad staff policies via `ALTER POLICY ... USING (...)` (in-place, not drop+recreate — only the `USING` clause changes):
    ```sql
    alter policy "gym_staff_read_own_members" on members
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
      );

    alter policy "gym_staff_read_own_subscriptions" on subscriptions
      using (
        gym_id = private.gym_id()
        and (
          (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
          or exists (
            select 1 from members m
            where m.id = subscriptions.member_id and m.user_id = auth.uid()
          )
        )
      );
    ```
  - [x] Two new additive SELECT policies:
    ```sql
    create policy "coach_read_assigned_members" on members
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = 'coach'
        and private.is_assigned_coach(id)
      );

    create policy "coach_read_assigned_subscriptions" on subscriptions
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = 'coach'
        and private.is_assigned_coach(member_id)
      );
    ```
  - [x] Do not alter `coach_assignments`' own RLS, `plans`' RLS (already ungated-by-role, coach already reads plan names via the existing `gym_staff_read_own_plans`), or any payments-table RLS (`0030` already deliberately excludes `'coach'` — out of scope, unaffected by this migration).
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` (WSL shell — see Dev Notes). Expect the new `private.is_assigned_coach` function signature to appear in the diff if it's ever surfaced there (it's `private`-schema, not exposed via PostgREST, so likely no visible `database.ts` change at all — confirm rather than assume).

- [x] **Task 2: `apps/dashboard/services/coaches.ts`** (modified) (AC: #2, #3, #4)
  - [x] Add `listAssignedMembers(params: { search?: string; sort?: string; dir?: string })`, querying `subscriptions_current` (Story 4.8's view — see Scope Notes for why this view and not a new one). Copy `getCallerGymId` usage from this file's existing functions (already present, do not duplicate a second copy in this same file). Shape mirrors `listSubscriptions()` (`services/subscriptions.ts`) structurally but with no `page`/pagination (Scope Notes: no pagination in this story) and an added `search` param (ilike on `member_name`):
    ```ts
    export interface CoachPortalMemberRow {
      memberId: string;
      memberName: string;
      planName: string;
      planType: string;
      status: "active" | "expiring_soon" | "grace_period" | "expired";
      expiryDate: string | null;
    }

    const COACH_PORTAL_SORT_COLUMN_MAP: Record<string, string> = {
      name: "member_name",
      plan: "plan_name",
      status: "status",
      expiry: "expiry_date",
    };

    function resolveCoachPortalSortColumn(sort: string | undefined): string {
      return (sort && COACH_PORTAL_SORT_COLUMN_MAP[sort]) || COACH_PORTAL_SORT_COLUMN_MAP.name;
    }

    export async function listAssignedMembers(params: {
      search?: string;
      sort?: string;
      dir?: string;
    }): Promise<{ data: CoachPortalMemberRow[] | null; error: AppError | null }> {
      const supabase = await createClient();
      const { gymId, error: gymIdError } = await getCallerGymId(supabase);
      if (gymIdError || !gymId) {
        return { data: null, error: gymIdError };
      }

      let query = supabase
        .from("subscriptions_current")
        .select("member_id, member_name, plan_name, plan_type, status, expiry_date")
        .eq("gym_id", gymId)
        .is("deactivated_at", null);

      if (params.search && params.search.trim()) {
        query = query.ilike("member_name", `%${params.search.trim()}%`);
      }

      query = query.order(resolveCoachPortalSortColumn(params.sort), {
        ascending: params.dir !== "desc",
      });

      const { data, error } = await query;
      if (error) {
        return { data: null, error: await mapAndLog(error) };
      }

      return {
        data: ((data ?? []) as unknown as {
          member_id: string; member_name: string; plan_name: string; plan_type: string;
          status: CoachPortalMemberRow["status"]; expiry_date: string | null;
        }[]).map((row) => ({
          memberId: row.member_id,
          memberName: row.member_name,
          planName: row.plan_name,
          planType: row.plan_type,
          status: row.status,
          expiryDate: row.expiry_date,
        })),
        error: null,
      };
    }
    ```
  - [x] `.is("deactivated_at", null)` matches `subscriptions_current`'s own established filter convention (`listSubscriptions()` uses the identical clause) — a deactivated member should not appear in a coach's active caseload.
  - [x] Distinguish the two empty-state cases the client needs (AC #4 vs. the mockup's "no search matches" state): this function returns `data: []` in both cases; the client (Task 4) tells them apart the same way `SubscriptionsPageClient.tsx` does (`total === 0 && !status && !planType` vs. the filtered-empty branch) — here, `rows.length === 0 && !search` (AC #4's copy) vs. `rows.length === 0 && search` ("No members match '[term]'." + Clear search).

- [x] **Task 3: `apps/dashboard/app/(dashboard)/coach/page.tsx`** (new) (AC: #1, #2, #4)
  - [x] Server Component + explicit `<Suspense>`, mirroring `subscriptions/page.tsx`'s exact structure (cookie-based Supabase read under this app's `cacheComponents: true`). No `getDashboardShellContext()` fetch needed — no role-conditional UI on this page (Scope Notes: no route guard, RLS is the real gate; every visitor who can reach this page already sees exactly what their own RLS-scoped query returns).
    ```tsx
    export default function CoachPortalPage({
      searchParams,
    }: {
      searchParams: Promise<{ search?: string; sort?: string; dir?: string }>;
    }) {
      return (
        <Suspense fallback={<CoachPortalLoading />}>
          <CoachPortalData searchParams={searchParams} />
        </Suspense>
      );
    }

    async function CoachPortalData({ searchParams }: { ... }) {
      const params = await searchParams;
      const { data: members, error } = await listAssignedMembers({
        search: params.search,
        sort: params.sort,
        dir: params.dir,
      });
      if (error) {
        const { t } = await getServerTranslation(await getRequestLocale());
        return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
      }
      return (
        <CoachPortalPageClient
          members={members ?? []}
          search={params.search ?? ""}
          sort={params.sort ?? "name"}
          dir={params.dir ?? "asc"}
        />
      );
    }
    ```

- [x] **Task 4: `apps/dashboard/app/(dashboard)/coach/loading.tsx`** (new) (AC: #2)
  - [x] Copy `subscriptions/loading.tsx`'s exact skeleton shape, 4 rows (AD-14's own spec, `EXPERIENCE.md` line 1727 — not the generic 8-row precedent other pages use).

- [x] **Task 5: `apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx`** (new) (AC: #2, #3, #4)
  - [x] `"use client"`, mirrors `SubscriptionsPageClient.tsx`'s URL-driven sort mechanism (`useRouter`/`useSearchParams`/`usePathname`, `updateParams`, `handleSort`, `aria-sort` on `<th>`) minus pagination (no `page` param, no page-window UI) and minus the CSV export button (no AC asks for one here).
  - [x] Search input (debounced, matching `MembersPageClient.tsx`'s existing 300ms-debounce precedent for its own name/phone search — reuse that exact debounce value for consistency, not a new number) that calls `updateParams({ search: value })`.
  - [x] Columns: Avatar-initial + Name, Plan (via `PLAN_TYPE_LABEL_KEY`, same map `SubscriptionsPageClient.tsx` already imports from `plans/planLabels.ts`), Status badge (reuse `STATUS_BADGE_CONFIG` from `subscriptions/subscriptionLabels.ts` verbatim — same 4-state config, do not duplicate it a third time), Expiry date (`formatLocalDate`, copied per-file same as `SubscriptionsPageClient.tsx` copied it from `MembersPageClient.tsx` — this file's own copy, not a cross-import). No "Last note" column (Scope Notes — cut, no data source until Story 5.3).
  - [x] Sortable headers: name, plan, status, expiry (Scope Notes — union of AC #2 and the AD-14 mockup).
  - [x] Row click: no-op in this story (AD-15 doesn't exist yet — Story 5.3 wires this up). Do not add a dead link or a button that 404s; render the row as a static (non-interactive) `<tr>` for now, and leave a short comment noting Story 5.3 makes it clickable — do not build a placeholder click handler.
  - [x] Three distinct empty states, matching `SubscriptionsPageClient.tsx`'s own conditional-empty-state pattern:
    - No assigned members at all, no search active: `t("coachPortal.emptyNoAssignments")` = "No members have been assigned to you yet. Ask your manager to assign members." (AC #4, verbatim from `EXPERIENCE.md` line 1349).
    - Search active, zero matches: `t("coachPortal.emptySearchNoMatch", { term: search })` = "No members match '{{term}}'." with a "Clear search" button (`updateParams({ search: "" })`) — `EXPERIENCE.md` line 1700.
    - (No third "filtered by status/plan" empty state — this story has no status/plan filter dropdowns, only sortable columns and search, unlike Subscriptions' filter selects.)

- [x] **Task 6: i18n** (AC: #2, #4)
  - [x] New keys under a new `coachPortal` namespace in `apps/dashboard/locales/en.json`/`fr.json`: `title` ("Coach Portal"), `searchPlaceholder` ("Search by name"), `table.name`, `table.plan`, `table.status`, `table.expiry`, `emptyNoAssignments` (AC #4's exact copy), `emptySearchNoMatch` (with `{{term}}` interpolation), `clearSearch` ("Clear search"). Reuse `members.status.*` for status badge labels and `PLAN_TYPE_LABEL_KEY`'s existing keys for plan labels — do not create duplicate status/plan-type strings a third time.
  - [x] Verify via `node scripts/check-i18n-key-parity.mjs`.

- [x] **Task 7: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) `private.is_assigned_coach()` is `SECURITY DEFINER`, unlike `private.gym_id()`/`private.is_super_admin()` — the first `private`-schema RLS helper to read a table rather than only the JWT, needed because a plain correlated subquery inside the new coach RLS policies would be silently blocked by `coach_assignments`'/`members`' own RLS on the calling coach session, producing an always-empty result rather than an error (Scope Notes has the full mechanism); (2) `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` are narrowed via `ALTER POLICY` to drop `coach` from their role arrays, closing the gap Story 5.1 explicitly deferred to this story; (3) the "Last note" column from the AD-14 mockup is cut (no `session_notes` table until Story 5.3), matching Story 4.8's "Last Payment column" precedent; (4) no pagination on this page (mockup/AC don't call for it, caseload is pilot-scale); (5) `/coach` has no route-level role guard beyond the existing gym-staff layout gate — Sidebar hides it from non-Coach roles, RLS is the real enforcement, same accepted-gap shape as `/subscriptions`/`/plans`/`/members`/`/attendance`.

- [x] **Task 8: pgTAP coverage — `supabase/tests/coach_portal_member_list.test.sql`** (new file) (AC: all)
  - [x] Mirror `coach_member_assignment.test.sql`'s (Story 5.1) fixture-seeding/session-simulation conventions.
  - [x] Seed: two gyms (A, B); gym A has an owner, manager, receptionist, two coaches (coach-1, coach-2), and four members — two assigned to coach-1 (one `active`, one `expired`, to directly test AC #2's "expired members remain visible"), one assigned to coach-2, one unassigned.
  - [x] **Critical regression test for the Scope Notes bug**: as coach-1, `select * from members where id = <coach-1's own assigned member>` returns exactly 1 row — this is the test that would have caught the naive-subquery version silently returning zero rows for every coach. Do not skip this in favor of only testing `subscriptions_current` — test the base tables directly too, since that's where the bug actually lives.
  - [x] As coach-1: `select * from subscriptions_current where gym_id = <gym A>` returns exactly coach-1's 2 assigned members (both `active` and `expired` rows present), never coach-2's member or the unassigned member.
  - [x] As coach-2: sees only their 1 assigned member.
  - [x] As coach-1, direct query for coach-2's assigned member's id: zero rows (AC #3 — "they do not appear in my list").
  - [x] As owner/manager/receptionist: `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` still return the full gym roster (regression check — confirms the `ALTER POLICY` narrowing didn't over-narrow the roles it was never meant to touch).
  - [x] Cross-gym: a coach session authenticated against gym A sees zero rows for gym B's `coach_assignments`/members, even with a coincidentally-matching assignment shape (tenant isolation, same style as every other RLS test file in this codebase).
  - [x] `private.is_assigned_coach()` called directly (as any role) for a real assignment: returns `true`; for a non-existent/ended assignment: returns `false`; never raises.

- [x] **Task 9: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` (WSL shell) — zero regressions against the pre-story baseline plus this story's new file. Confirmed (grep, pre-implementation): neither `coach_member_assignment.test.sql` (Story 5.1) nor `rls_tenant_isolation.test.sql` contains any assertion about a coach's read access to `members`/`subscriptions`, so no existing test is expected to need updating for the narrowing itself — but re-run the full suite anyway and treat any unexpected new failure as a real regression, not noise.
  - [x] Hands-on (WSL-only Supabase convention, per Dev Notes): using the coach rows seeded for Story 5.1's own manual testing (or fresh ones, since no UI creates coach accounts — Story 5.1 Scope Notes), log in as a coach with at least one assigned member (one `active`, ideally one `expired` too) and confirm: the Coach Portal shows only assigned members; sorting by each of Name/Plan/Status/Expiry works both directions; searching narrows the list and the "no match" empty state appears for a nonsense search term with a working "Clear search"; a coach with zero assignments sees AC #4's exact empty-state copy; the Sidebar shows only "Coach Portal" for this session (regression check on Story 1.8's existing behavior).

### Review Findings

- [x] [Review][Patch] `listAssignedMembers` search doesn't escape ILIKE wildcards (`%`/`_`/`\`/`"`), unlike the established `escapeIlike()` convention in `members.ts`/`subscriptions.ts` [apps/dashboard/services/coaches.ts:236-238] — fixed: added a matching `escapeIlike()` helper and applied it.
- [x] [Review][Patch] Client empty-state branch checks raw `search` truthiness instead of `search.trim()`, so a whitespace-only `?search=` shows the "no match" empty state instead of AC #4's copy, inconsistent with the server-side trim in `listAssignedMembers` [apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx:117] — fixed: condition now checks `search.trim()`.
- [x] [Review][Patch] `docs/decisions.md` entry omits Task 7's 5th required point (`/coach` has no route-level role guard, same accepted-gap shape as other pages) [docs/decisions.md] — fixed: added Decision 4.
- [x] [Review][Patch] `subscriptions/page.tsx`'s comment ("Receptionist or Coach reaching this route directly still gets full read access") is now stale for Coach — 0040's `ALTER POLICY` narrowing removed `coach` from `gym_staff_read_own_subscriptions`, so a Coach reaching `/subscriptions` directly no longer gets full-roster access [apps/dashboard/app/(dashboard)/subscriptions/page.tsx:20] — fixed: comment updated to reflect Coach's narrowed access post-0040.
- [x] [Review][Patch] Task 8's pgTAP fixture "Member 4" is a previously-assigned-now-ended member, not a genuinely unassigned member as the task's fixture description specifies — no fixture member with zero `coach_assignments` rows exists [supabase/tests/coach_portal_member_list.test.sql] — fixed: added Member 5 (zero `coach_assignments` rows) plus two new assertions (Coach 1 and Coach 2 both see 0 rows for Member 5); `plan(18)` → `plan(20)`. Verified via `supabase test db`: 587/587 tests pass, including this file.
- [x] [Review][Defer] `sort`/`dir` query params are passed to the client unvalidated, so a hand-edited invalid value can desync the `aria-sort`/arrow indicator from the actual applied order [apps/dashboard/app/(dashboard)/coach/page.tsx:59-60] — deferred, pre-existing (identical unvalidated pass-through already exists in `subscriptions/page.tsx`, the template this story mirrors; fixing only this page would diverge from the established pattern)
- [x] [Review][Defer] `private.is_assigned_coach()` is `SECURITY DEFINER` with no self-contained tenant check on `p_member_id` — safety currently depends on every calling RLS policy also checking `gym_id = private.gym_id()` on the target row [supabase/migrations/0040_coach_portal_member_list_rls.sql] — deferred, matches the spec-mandated shape exactly and is safe under all current call sites; a note for future callers of this helper
- [x] [Review][Defer] No uniqueness constraint on `coach_assignments` prevents two coaches simultaneously holding a non-ended assignment to the same member [supabase/migrations/0039_coach_member_assignment.sql] — deferred, pre-existing from Story 5.1, out of scope here
- [x] [Review][Defer] A member with a `coach_assignments` row but no `subscriptions` row is silently invisible to their coach (inner-join-like behavior of `subscriptions_current`) [apps/dashboard/services/coaches.ts:230-234] — deferred, inherent to the `subscriptions_current` view this story was directed to reuse; matches an existing accepted pattern elsewhere in the codebase

## Dev Notes

- **Read before starting:** `supabase/migrations/0018_member_management.sql` (lines 150–256, the two policies this story narrows, plus their own "revisit in Epic 5" comment this story resolves), `supabase/migrations/0039_coach_member_assignment.sql` (`coach_assignments` shape, `manager_or_owner_read_own_coach_assignments`'s existing narrow SELECT policy this story does *not* touch), `supabase/migrations/0037_subscriptions_page_manual_renewal.sql` (`subscriptions_current` view — this story's primary data source, and its own comment on why `security_invoker = true` is "not optional"), `supabase/migrations/0009_auth_hook_gym_claims.sql` (`private.gym_id()` — the plain-`STABLE`, JWT-only shape `private.is_assigned_coach()` deliberately deviates from), `apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx` (in full — the structural template this story's client component follows, minus pagination/CSV/filter-dropdowns), `apps/dashboard/services/coaches.ts` (existing file this story adds to — `getCallerGymId`, established conventions), `apps/dashboard/components/shared/Sidebar.tsx` line 44 (existing `/coach` nav entry, unchanged by this story).
- **This project's local Supabase stack runs inside WSL2, not native Windows** — `supabase db reset`/`supabase test db`/`supabase gen types` must run from a WSL shell. [Memory: Supabase runs in WSL — confirmed working through Story 5.1's session.]
- **Testing standard:** pgTAP is the primary automated coverage (Task 8) — and for this story specifically, the *only* thing that can actually prove the RLS narrowing works, since the Scope Notes' central bug (a naive subquery silently returning zero rows for every coach) produces no error, no exception, no typecheck failure — only a wrong empty result set that manual clicking might even be mistaken for "the empty-state AC #4 working correctly." Do not skip or under-weight Task 8's base-table regression test.
- **Do not build:** the AD-15 member-detail route (`/coach/[memberId]`, Story 5.3), `addSessionNote` or any `coach/actions.ts`, a "Last note" column, pagination, or any change to `coach_assignments`' own RLS (Scope Notes).
- **`apps/mobile` and `apps/super-admin` are untouched by this story.**

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0040_coach_portal_member_list_rls.sql              (new)
  supabase/tests/coach_portal_member_list.test.sql                       (new)
  packages/types/src/database.ts                                        (regenerated — likely no visible diff, private schema not PostgREST-exposed)
  apps/dashboard/services/coaches.ts                                     (modified — listAssignedMembers added)
  apps/dashboard/app/(dashboard)/coach/page.tsx                          (new — AD-14)
  apps/dashboard/app/(dashboard)/coach/loading.tsx                       (new)
  apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx  (new)
  apps/dashboard/locales/en.json                                        (modified)
  apps/dashboard/locales/fr.json                                        (modified)
  docs/decisions.md                                                     (modified)
  ```
  - No `packages/types` Zod schema needed — no Server Action input in this story (pure read, no `actions.ts`).
  - `apps/dashboard/components/shared/Sidebar.tsx` is **not** in this list — its `/coach` entry already exists (Story 1.8), unchanged.
  - Matches `architecture.md`'s file tree exactly: `coach/page.tsx` is AD-14; `coach/[memberId]/page.tsx` and `coach/actions.ts` are explicitly Story 5.3's, not created here.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-022] — "Coaches can view only their assigned members' profiles"
- [Source: _bmad-output/planning-artifacts/epics.md#FR-053] — Coach Portal role-gated dashboard section
- [Source: _bmad-output/planning-artifacts/epics.md#FR-054] — V1 Coach Portal features: assigned member list (sortable, status shown), expired members remain visible without auto-notification
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 1325–1349] — AD-14 mockup: layout, columns, search, sort options, empty state copy
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md line 1700] — search-empty state copy ("No members match '[term]'.", Clear search action)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md line 1727] — AD-14 loading skeleton: 4 rows
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md line 77] — AD-14 route `/coach`, role Coach
- [Source: _bmad-output/planning-artifacts/architecture.md line 335–338] — file tree: `coach/page.tsx` (AD-14, this story), `coach/[memberId]/page.tsx` + `coach/actions.ts` (AD-15, Story 5.3, not built here)
- [Source: _bmad-output/planning-artifacts/architecture.md line 464] — Coach Portal (FR-053–056) maps to `apps/dashboard/.../coach/`
- [Source: supabase/migrations/0018_member_management.sql lines 154–172, 218–238] — `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions`, both narrowed by this story; their own pre-existing "revisit in Epic 5" comments
- [Source: supabase/migrations/0037_subscriptions_page_manual_renewal.sql] — `subscriptions_current` view (this story's data source), `security_invoker = true` rationale
- [Source: supabase/migrations/0039_coach_member_assignment.sql] — `coach_assignments` table shape, `manager_or_owner_read_own_coach_assignments` (unmodified by this story), `assign_coach()`'s explicit revoke/grant discipline this story's `private.is_assigned_coach()` follows
- [Source: supabase/migrations/0009_auth_hook_gym_claims.sql] — `private.gym_id()`, the plain-STABLE precedent `private.is_assigned_coach()` deliberately deviates from (adds SECURITY DEFINER)
- [Source: supabase/migrations/0010_super_admin_gym_provisioning.sql lines 8–25] — `private.is_super_admin()`, second precedent for a plain-STABLE `private`-schema helper (JWT-only, no SECURITY DEFINER)
- [Source: docs/decisions.md, 2026-07-06 entry, "Also caught during this story"] — `custom_access_token_hook()`'s own SECURITY DEFINER fix for the identical class of bug (a function whose internal reads are blocked by RLS for the role it runs as) — the direct precedent `private.is_assigned_coach()`'s design follows
- [Source: apps/dashboard/app/(dashboard)/subscriptions/components/SubscriptionsPageClient.tsx] — structural template: URL-driven sort (`handleSort`, `aria-sort`, `updateParams`), conditional empty states, `STATUS_BADGE_CONFIG` usage, `formatLocalDate` per-file copy
- [Source: apps/dashboard/app/(dashboard)/subscriptions/subscriptionLabels.ts] — `STATUS_BADGE_CONFIG`, reused verbatim (not duplicated) by this story's client component
- [Source: apps/dashboard/app/(dashboard)/plans/planLabels.ts] — `PLAN_TYPE_LABEL_KEY`, reused for the Plan column
- [Source: apps/dashboard/services/subscriptions.ts lines 194–332] — `listSubscriptions()`, the structural template `listAssignedMembers()` follows (minus pagination, plus search)
- [Source: apps/dashboard/services/coaches.ts] — existing file this story adds `listAssignedMembers` to; `getCallerGymId` pattern already present
- [Source: apps/dashboard/app/(dashboard)/attendance/page.tsx lines 26–38] — "Sidebar hides it, RLS is the real gate" precedent comment, reused verbatim reasoning for `/coach`'s own lack of a route guard
- [Source: apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx] — 300ms search-debounce precedent this story's search input reuses
- [Source: apps/dashboard/components/shared/Sidebar.tsx line 44] — existing `/coach` nav entry (`roles: ["coach"]`), unchanged
- [Source: _bmad-output/implementation-artifacts/5-1-coach-member-assignment.md] — most recent prior story; `coach_assignments` schema/grant shape, `docs/decisions.md` entry discipline, WSL Supabase note, and the exact "over-broadening... revisit in Epic 5" gap this story closes

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

- All 9 tasks implemented as specified. `private.is_assigned_coach()` (SECURITY DEFINER) plus the `ALTER POLICY` narrowing of `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` landed in `0040_coach_portal_member_list_rls.sql`, closing the gap Story 5.1 deferred.
- `pnpm run typecheck` (all packages): 0 errors. `node scripts/check-i18n-key-parity.mjs`: 0 errors.
- `supabase test db` (WSL, after `supabase db reset`): 585/585 tests pass, zero regressions — including the updated `dashboard_shell_self_read_rls.test.sql` assertion (coach's full-roster visibility correctly reverts to 0 rows for a non-assigned member) and the new `coach_portal_member_list.test.sql` (18/18, including the base-table regression test for the SECURITY DEFINER helper).
- Hands-on manual verification (Task 9): seeded a coach account (fixture members/subscriptions/coach_assignments via direct SQL — no UI creates coach logins, per Story 5.1's own note) and confirmed via the running dashboard dev server that the Coach Portal correctly shows only assigned members.

### File List

- `supabase/migrations/0040_coach_portal_member_list_rls.sql` (new)
- `supabase/tests/coach_portal_member_list.test.sql` (new)
- `supabase/tests/dashboard_shell_self_read_rls.test.sql` (modified)
- `apps/dashboard/services/coaches.ts` (modified)
- `apps/dashboard/app/(dashboard)/coach/page.tsx` (new)
- `apps/dashboard/app/(dashboard)/coach/loading.tsx` (new)
- `apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx` (new)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `docs/decisions.md` (modified)
