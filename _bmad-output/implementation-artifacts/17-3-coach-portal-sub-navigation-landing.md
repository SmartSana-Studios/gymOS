---
baseline_commit: be642d0d547b2b190b513096cc3a125ec8604732
---

# Story 17.3: Coach Portal — Sub-Navigation & Landing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Coach,
I want the Coach Portal to have its own navigation and to be where I land when I sign in,
so that I am not dropped onto a staff page I have no link back from.

*No migration. Zero RLS policies modified. Launch-blocking — today a Coach signs in, lands on the staff Overview, and has one sidebar link that does not point back to where they are.*

## Acceptance Criteria

1. When `(dashboard)/page.tsx` resolves a session whose `shell.role` is `"coach"`, it `redirect("/coach/overview")`. The redirect lives in `page.tsx`, **not** `(dashboard)/layout.tsx`: the layout wraps every dashboard route including `/coach/*`, so a redirect there would need path-matching to avoid looping — the same reasoning `layout.tsx:113-120` already records for its `mustChangePassword` redirect ("no loop risk: the target is a top-level route, not nested under this route group"), which does **not** hold for `/coach/overview`.

2. The redirect is evaluated **before** the page's other data fetches. Today `page.tsx:35-39` batches `getDashboardShellContext()` into a `Promise.all` with `listActiveFrontDeskAlerts()` and `canOfferMobileMoneyPayment()`. Hoist the shell read above that `Promise.all` and branch on it first, so a Coach never pays for alert/feature-flag reads (and, once Story 17.1 lands, three more) on a page they are being redirected off. `services/session.ts:128-133` documents the same "read claims first, outside the `Promise.all`" discipline for a related reason. `redirect()` throws a control-flow signal — it must not sit inside a `try`/`catch` or a `Promise.all`. Separately, `OverviewPage`'s `<Suspense>` fallback must not render staff Overview copy: `redirect()` in a streaming context is emitted as a client-side meta-tag redirect (Next 16.3.4 `redirect.md`), so whatever the fallback renders is flushed to the Coach *before* the bounce — and today `OverviewFallback` (`page.tsx:59-66`) renders `overview.title` plus the `overview.body` placeholder, i.e. exactly the staff copy this epic exists to remove. This is why `(dashboard)/layout.tsx`'s three `redirect()` calls are invisible and this one would not be: that layout's fallback is `null` (`layout.tsx:17`). Replace it with `null` or a role-neutral skeleton, and coordinate with Story 17.1 — a Coach must not see its stat-card skeleton either.

3. `getDashboardShellContext()` is wrapped in React `cache()` in `services/session.ts`. This story does not create the duplication — `(dashboard)/layout.tsx:41` and every page that also reads the shell already call it twice per request today (`page.tsx:36`, `members/page.tsx:58`, `classes/page.tsx:34`, `payments/page.tsx:34`, `attendance/page.tsx:73`, `audit/page.tsx:51`, `settings/staff/page.tsx:49`), each paying a second round of its DB reads (`gyms` status, then a `Promise.all` of `members` + `users` + cross-gym `members`, `session.ts:180` and `:230-249`). What this story does is make that second read unavoidable on `/`, since the shell must be read before the redirect — which is the moment to close it for all of them. Memoizing is safe: the function takes no arguments, and no caller depends on a second fresh read (`switchActiveGym`, `session.ts:338-355`, mutates and refreshes the session before anything re-reads the shell). `lib/i18n/get-request-locale.ts:24` is the in-repo precedent for exactly this wrap. Verify `(dashboard)/layout.gymSwitchRemount.test.tsx` still passes afterwards.

4. The top-level sidebar is **unchanged in content**: `Sidebar.tsx:51`'s single `{ labelKey: "nav.coachPortal", href: "/coach", roles: ["coach"] }` entry stays exactly as it is, and no new item is added for any role. Story 5.2 AC#1 ("Payments, Members, Settings, and Audit Log are absent from the DOM") stays literally true, because `Sidebar.tsx:78`'s `NAV_ITEMS.filter(...)` still never renders them for a Coach.

5. The sidebar's active-state match is fixed so the Coach Portal item stays lit inside the Portal. Today `Sidebar.tsx:108` is `pathname === item.href` — strict equality — so a Coach on `/coach/overview` or `/coach/classes` sees **no** lit sidebar item at all. Replace it with: if some nav item's `href` exactly equals `pathname`, only that item is active; otherwise the item with the **longest** `href` that `pathname` starts with (followed by `/`) is active, excluding `"/"` from prefix matching. This lights `/coach` on all four Portal routes, keeps `/settings/staff` lighting Staff rather than both Staff and Settings (exact match wins), lights `/members` on `/members/new`, and never lights Overview on everything. Do not use a bare `pathname.startsWith(item.href)` — `"/"` prefixes every route and `/settings` prefixes `/settings/staff`. Compute the winner once over the whole filtered `items` list (`Sidebar.tsx:78`), not per item: "longest wins" cannot be expressed by a per-item predicate. `usePathname()` returns no query string, so `/subscriptions?status=expiring_soon` needs no special handling.

6. A new `app/(dashboard)/coach/layout.tsx` (there is none today, under `coach/` or `[memberId]/`) hosts the Portal heading and sub-navigation, so both render on all four Portal routes — `/coach`, `/coach/overview`, `/coach/classes`, and `/coach/[memberId]` — per `EXPERIENCE.md:1779`. It stays a Server Component (it needs `getServerTranslation` for the labels); only the active-state read crosses the client boundary, matching `apps/super-admin/components/AdminNavLink.tsx`'s split.

7. The sub-nav offers exactly three items in this order — Overview (`/coach/overview`), My Members (`/coach`), My Classes (`/coach/classes`) — with the active surface indicated both visually and via `aria-current="page"` (the accessibility half of "active surface indicated"; `AdminNavLink.tsx:40` is the precedent, `Sidebar.tsx` omits it).

8. Active-surface detection uses `useSelectedLayoutSegment()` from `next/navigation`, not `usePathname()` prefix arithmetic. Called from a `"use client"` component inside `coach/layout.tsx` it returns `null` on `/coach`, `"overview"` on `/coach/overview`, `"classes"` on `/coach/classes`, and the member UUID on `/coach/[memberId]`. So: Overview active iff `segment === "overview"`; My Classes active iff `segment === "classes"`; My Members active otherwise — which correctly keeps My Members lit on AD-15's member-detail route, exactly as `EXPERIENCE.md:1779` requires, with no hardcoded exclusion list to drift.

9. **That client component must be wrapped in its own `<Suspense>` inside `coach/layout.tsx`.** Under `cacheComponents: true` (`next.config.ts:9`), `useSelectedLayoutSegment` suspends on any route whose dynamic param is not known at build time, and `/coach/[memberId]` has no `generateStaticParams` — so without a boundary, `next build` **fails**, not warns (Next 16.3.4 docs, `use-selected-layout-segment.md` § Behavior → Cache Components). Give it a fallback that reserves the nav's layout (three inert label-width placeholders), not `null`, so the heading does not jump on the member-detail route. **`next build` will not catch a missing boundary here.** The docs say "wrap the component **(or a parent)**", and `(dashboard)/layout.tsx:17` already wraps `children` in `<Suspense fallback={null}>` — so the build exits 0 either way. Omitting the nested boundary instead makes the suspension bubble to that ancestor, whose fallback is `null`, blanking the **entire dashboard chrome** (sidebar, top bar, heading and page) during prerender/streaming on `/coach/[memberId]`. Verify by inspection and by Task 8's `CoachPortalNav` test, not by the build.

10. `app/(dashboard)/coach/overview/page.tsx` is created and is a **real landing page, not a placeholder** — a Coach reaches it on every sign-in, and shipping "your summary will appear here" is the precise failure Epic 17 exists to correct. Scope it to AD-20's "My Members At A Glance" widget only: assigned-member count broken down by subscription status, sourced from the already-shipped `listAssignedMembers()` (`services/coaches.ts:227`, RLS-scoped by `coach_read_assigned_members` and `coach_read_assigned_subscriptions` (`0040`), since it reads the `security_invoker` view `subscriptions_current` — no new query, no new policy, no migration), with an "All →" link to `/coach`. When the Coach has no assigned members it shows AD-14's copy instead: the existing `coachPortal.emptyNoAssignments` key ("No members have been assigned to you yet. Ask your manager, owner, or supervisor to assign members.") — reuse it, do not add a duplicate. **Story 17.5 owns the other three widgets** (My Next Sessions, Needs Follow-Up, Recent Progress Activity) and the per-widget error isolation; do not build them here. Bookkeeping that must happen in the same commit: this widget and its no-assignments empty state are currently written as ACs of **Story 17.5** in `epics.md`. Amend Story 17.5's AC list there to remove both, and record the transfer in `sprint-status.yaml`'s `last_updated` — do not leave the two documents disagreeing about who owns it.

11. `app/(dashboard)/coach/classes/page.tsx` is created so the My Classes sub-nav item does not 404. **Story 17.4 owns its contents** (coach-scoped class list, session expansion, and the `list_my_class_session_roster()` RPC in migration 0096) — resolving the Coach's own `members.id` server-side from `auth.uid()` + `private.gym_id()` is 17.4's AC#1 and is deliberately not attempted here. Until 17.4 lands this route renders the sub-nav and a neutral one-line note. It must **not** render AD-21's "You are not assigned to any classes yet…" empty state, which would be a false statement to a Coach who does have classes. See the sequencing note in Dev Notes — this is the one surface that is knowingly incomplete at the end of this story.

12. `/coach` continues to serve the AD-14 member list at its existing URL and `/coach/[memberId]` is unmoved. Both new routes are static siblings of the dynamic segment; Next.js resolves static segments before dynamic ones and member IDs are UUIDs, so `overview` and `classes` cannot collide with a real member ID. The four existing `/coach/*` navigations must all still work: `CoachPortalPageClient.tsx:169`, `:171`, `:199` (a template-literal `router.push` to `/coach/<memberId>` — row click, Enter key, and the View button) and `e2e/progress-data-privacy.spec.ts:106` (`page.goto`). There are **no** `<Link href="/coach/...">` elements anywhere; every in-app navigation is imperative `router.push`.

13. The Portal heading moves up. `CoachPortalPageClient.tsx:103` renders `<h1>{t("coachPortal.title")}</h1>` today; every AD-20/AD-21 mockup puts "Coach Portal" **above** the sub-nav on all three surfaces (`EXPERIENCE.md:1659,1761,1798`). Move the `<h1>` into `coach/layout.tsx` and delete it from `CoachPortalPageClient.tsx`, so `/coach` does not render it twice and the three surfaces are consistent. On `/coach/[memberId]`, AD-15's own mockup (`EXPERIENCE.md:1689`) specifies a breadcrumb `← Coach Portal / [Member Name]` rather than a plain heading; that member-detail page has no back affordance at all today. This story renders the shared `<h1>` + sub-nav there instead, with the sub-nav's lit My Members item as the back path, and defers the breadcrumb form — record that in `deferred-work.md`.

14. A non-Coach staff session reaching `/coach/*` directly behaves exactly as it does today. This story introduces **no** new route-level role guard and closes **no** existing gap — the precedent is documented verbatim in `coach/page.tsx:14-24` ("No route-level role guard beyond `(dashboard)/layout.tsx`'s existing gym-staff gate — this app's established 'Sidebar hides it, RLS is the real gate' precedent"). Do not add one; no AC asks for it and it would be a new, untested behaviour on four routes.

15. Story 5.2 AC#1 gains its first automated test. **No such test exists today** — there is no `Sidebar.test.tsx` anywhere in the repo, and no Vitest or Playwright test asserts those items are absent for a Coach; Story 5.2 recorded the AC as already-satisfied-by-inspection. Add `apps/dashboard/components/shared/Sidebar.test.tsx` asserting that with `role="coach"` the rendered DOM contains the Coach Portal link and contains **no** Payments, Members, Settings, or Audit Log link, and that with `role="owner"` those items *are* present (the positive control — an absence assertion that passes for the wrong reason is worse than none). Mock `usePathname` (`MembersPageClient.sendInvite.test.tsx:28` is the shape), `react-i18next`, and `./GymSwitcher` — `Sidebar.tsx:24` imports it, and it pulls `@/app/(dashboard)/actions` (a `"use server"` module) and `next/headers` behind it into jsdom, which no existing test in this repo does. Render with `isMobileOpen={false}`: at `true`, `SidebarContent` renders **twice** (`Sidebar.tsx:170` and `:190`) and every `getBy*` link query throws on duplicate matches. `globals` is not enabled, so import `describe`/`it`/`expect`/`vi` from `vitest` explicitly.

16. A test covers the coach redirect, following `(dashboard)/layout.gymSwitchRemount.test.tsx`'s technique for async Server Components — reach through the `<Suspense>` element to the async child and `await` it, no renderer needed. Mock `redirect` to **throw a sentinel** — as `layout.gymSwitchRemount.test.tsx:88-92` does — and assert the coach case *rejects* with it. A plain non-throwing `vi.fn()` returns `undefined`, execution falls through into the `Promise.all`, and the assertion "redirect was called" passes while the page still renders staff content. Assert the owner case resolves and `redirect` was never called. The page pulls in several modules that must also be mocked: `@/services/session`, `@/services/frontDeskAlerts`, `@/lib/featureFlags`, `@/components/shared/FrontDeskAlertPanel`, `@/lib/i18n/get-request-locale`, `@/lib/i18n/get-server-translation`.

17. Both `apps/dashboard/locales/en.json` and `fr.json` carry every new key and `node scripts/check-i18n-key-parity.mjs` passes. The full set is: the three sub-nav labels, every string AC #10 introduces (widget title, the count and per-status labels — reuse `members.status.*` rather than new ones — and the "All →" link), and AC #11's placeholder note. New keys go under the existing `coachPortal` namespace (`en.json`/`fr.json:585`) as `coachPortal.subNav.{overview,myMembers,myClasses}` — a sibling of `coachPortal.detail`, mirroring how `coachPortal.detail.tabs.*` is already shaped. Write real French; the parity script checks key presence only and will pass a copy-pasted English value.

18. `pnpm --filter @gymos/dashboard build` exits 0. Treat this as a general regression gate, **not** as the gate for AC #9 — see AC #9 for why the ancestor boundary at `layout.tsx:17` makes the build pass either way.

## Tasks / Subtasks

- [x] Task 1 — Coach redirect in `page.tsx` (AC: #1, #2)
  - [x] `import { redirect } from "next/navigation";` (same import form as `(dashboard)/layout.tsx:2`)
  - [x] In `OverviewData`, hoist `const { data: shell } = await getDashboardShellContext();` above the existing `Promise.all`, then `if (shell?.role === "coach") redirect("/coach/overview");`, then run the remaining fetches with the already-resolved `shell`
  - [x] Keep the outer `<Suspense fallback={...}><OverviewData /></Suspense>` shape — `redirect()` from inside a Suspense-wrapped async Server Component is supported and is the same mechanism `(dashboard)/layout.tsx` already relies on (`spec-cache-components-suspense-boundary-fix.md`)

- [x] Task 2 — `cache()`-wrap the shell read (AC: #3)
  - [x] Wrap `getDashboardShellContext` in React `cache()` in `services/session.ts`, mirroring `lib/i18n/get-request-locale.ts:24`
  - [x] Re-run `(dashboard)/layout.gymSwitchRemount.test.tsx` and `services/session.switchActiveGym.test.ts`

- [x] Task 3 — Sidebar active-state (AC: #4, #5)
  - [x] Replace `Sidebar.tsx:108`'s `pathname === item.href` with the exact-match-wins-else-longest-prefix rule from AC #5, computed once over the filtered `items` list rather than per item
  - [x] Do not change `NAV_ITEMS` at all
  - [x] Manually confirm: `/` lights Overview only; `/settings/staff` lights Staff only; `/members/new` lights Members; `/coach/overview` and `/coach/[memberId]` light Coach Portal

- [x] Task 4 — `coach/layout.tsx` + sub-nav (AC: #6, #7, #8, #9, #13)
  - [x] Create `app/(dashboard)/coach/layout.tsx` — Server Component; renders `<h1>{t("coachPortal.title")}</h1>`, then `<Suspense fallback={<CoachPortalNavFallback />}><CoachPortalNav /></Suspense>`, then `{children}`
  - [x] Create `app/(dashboard)/coach/components/CoachPortalNav.tsx` — `"use client"`, `useSelectedLayoutSegment()`, three `<Link>`s, `aria-current="page"` on the active one. Reuse `AdminNavLink.tsx`'s active/inactive class pair (`font-medium text-foreground underline underline-offset-8 decoration-2` / `text-muted-foreground hover:text-foreground`) so the two apps stay visually consistent
  - [x] Labels via `useTranslation()` inside the client component (it is a client component, so the `t()` hook — not `getServerTranslation`)
  - [x] Fallback reserves the row's height/width; not `null`
  - [x] Drop the now-duplicated heading skeleton from `coach/loading.tsx:7` (`h-8 w-40`) and decide deliberately about `coach/[memberId]/loading.tsx:10` (`h-6 w-40`) — after the `<h1>` moves into the layout it renders immediately, so a heading placeholder below it is a double heading
  - [x] Delete the `<h1>` at `CoachPortalPageClient.tsx:103` (and the now-single-child wrapper `<div>` at :102 if it becomes redundant)

- [x] Task 5 — `/coach/overview` (AC: #10)
  - [x] Create `app/(dashboard)/coach/overview/page.tsx` following `coach/page.tsx:26-63`'s exact shape: sync default export → `<Suspense fallback={...}>` → async data component → inline `<div className="text-sm text-red-600">{t("common.loadError")}</div>` on error (this app renders inline errors, never `notFound()` — `coach/[memberId]/page.tsx:50-58`)
  - [x] One call to `listAssignedMembers({})`; group `row.status` into counts; render total + per-status breakdown + "All →" → `/coach`
  - [x] Zero assigned members → `coachPortal.emptyNoAssignments`
  - [x] Reuse `members.status.*` label keys and the existing status badge config rather than new copy
  - [x] Optional sibling `loading.tsx` matching `coach/loading.tsx`'s shape

- [x] Task 6 — `/coach/classes` route shell (AC: #11)
  - [x] Create `app/(dashboard)/coach/classes/page.tsx` with a neutral one-line note (new i18n key) and nothing else
  - [x] Add a header comment naming Story 17.4 as the owner of this file's real contents, so the next dev extends rather than rewrites
  - [x] Do **not** query `classes`, do **not** resolve the Coach's `members.id`, do **not** render AD-21's empty state

- [x] Task 7 — i18n (AC: #17)
  - [x] Add `coachPortal.subNav.{overview,myMembers,myClasses}` and the overview/classes strings to `en.json` and `fr.json`
  - [x] `node scripts/check-i18n-key-parity.mjs` → clean

- [x] Task 8 — Tests (AC: #15, #16)
  - [x] `components/shared/Sidebar.test.tsx` — coach absence assertions **plus** the owner positive control
  - [x] `app/(dashboard)/page.coachRedirect.test.tsx` — redirect called with `/coach/overview` for a coach shell; not called for an owner shell
  - [x] Consider a `CoachPortalNav` test mocking `useSelectedLayoutSegment` across `null` / `"overview"` / `"classes"` / a UUID, asserting `aria-current` lands on the right item — this is where AC #8's member-detail case is cheapest to prove

- [x] Task 9 — Verify (AC: #12, #18)
  - [x] `pnpm --filter @gymos/dashboard typecheck`, `lint`, `test`
  - [x] `pnpm --filter @gymos/dashboard build` — must exit 0 (this is what catches a missing Suspense boundary around `useSelectedLayoutSegment`)
  - [x] `node scripts/check-i18n-key-parity.mjs` → clean
  - [x] Confirm `/coach` still serves AD-14 and `/coach/<uuid>` still serves AD-15; `pnpm --filter @gymos/dashboard test:e2e` if the environment allows, or at minimum re-read `e2e/progress-data-privacy.spec.ts:106` against the new route tree

### Review Findings

- [x] [Review][Patch] Give the `/` gate boundary a role-neutral skeleton instead of `fallback={null}` (decision delegated by smartsana, 2026-09-10: option A, AC #2's "role-neutral skeleton"). On a client-side navigation to `/`, the shared layout is not re-rendered, so the `cache()`d shell read misses and staff saw an empty content area for a full shell round trip before 17.1's skeleton. The new fallback must carry no text and no stat-card shape, so a Coach bounced to the Portal still never sees staff content. Update `page.coachRedirect.test.tsx`'s null-fallback assertion to match. [apps/dashboard/app/(dashboard)/page.tsx:58]
- [x] [Review][Patch] A gym switch always sends the user to `/`, so the landing redirect re-routes by the new gym's role (decision resolved by smartsana, 2026-09-10: option C, every route and every role). Previously a multi-gym user who switched from a coach gym to a staff gym stayed on `/coach/overview`, where RLS-scoped `listAssignedMembers()` counted the whole gym as "My Members". Covers both switch call sites: `GymSwitcher.tsx:98` and `SuspendedGymScreen.tsx:74`. Mind `update-password-form.tsx:94-108`: `router.push("/")` can be served from the client router cache. [apps/dashboard/components/shared/GymSwitcher.tsx:98]
- [x] [Review][Patch] `/coach/classes` has no `loading.tsx`, so `coach/loading.tsx`'s 4-row member-list skeleton shows while navigating to My Classes [apps/dashboard/app/(dashboard)/coach/classes/page.tsx:1]
- [x] [Review][Patch] The Portal sub-nav adds a second unlabelled `<nav>` landmark next to the sidebar's; give it a translated `aria-label` [apps/dashboard/app/(dashboard)/coach/components/CoachPortalNav.tsx:37]
- [x] [Review][Patch] The widget handover is written only on 17.5's side of `epics.md`: Story 17.3's own section lacks the two transferred ACs, and 17.5 is not told to bring `/coach/overview/loading.tsx` from 1 skeleton card to AD-20's 4 [_bmad-output/planning-artifacts/epics.md:768]
- [x] [Review][Defer] `subscriptions_current` inner-joins `subscriptions` to `members`, so an assigned member with no subscription row is missing from the At-A-Glance total, and a Coach whose assignees all lack one sees "No members have been assigned to you yet" [apps/dashboard/services/coaches.ts:239] — deferred, pre-existing
- [x] [Review][Defer] The Sidebar marks its active item with classes only, with no `aria-current="page"` [apps/dashboard/components/shared/Sidebar.tsx:131] — deferred, pre-existing

## Dev Notes

- **Read `apps/dashboard/AGENTS.md` first.** It is a short generic block whose one instruction is to read `apps/dashboard/node_modules/next/dist/docs/` before writing routing code, because this Next.js has breaking changes vs. training data. The specifics come from elsewhere: the version is **16.3.4** (`apps/dashboard/package.json` / `node_modules/next/package.json`), and two facts this story depends on: `middleware.ts` is now `proxy.ts` (confirmed by the file itself — there is no `middleware.ts`; and `proxy.ts` only refreshes the Supabase session, doing **no** role routing, which is why the redirect belongs in `page.tsx`), and `params`/`searchParams` are Promises (`coach/[memberId]/page.tsx:11-21`).

- **The `useSelectedLayoutSegment` + Cache Components interaction is the single most likely way to break the build**, and it is invisible in dev, typecheck, lint and unit tests. Read `apps/dashboard/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-selected-layout-segment.md` § Behavior → Cache Components before writing the nav. Summary: a tab bar in a parent layout suspends on any page below it with an unknown dynamic param, "even when the component that calls `useSelectedLayoutSegment` is itself static" — and `/coach/[memberId]` is exactly that case.

- **Why `useSelectedLayoutSegment` and not `usePathname`.** The recon of this app turned up `AdminNavLink.tsx`'s prefix rule (`pathname === href`, or `pathname` starts with `href` followed by a slash), which looks like the obvious model — but it is wrong here: `/coach` prefixes `/coach/overview` and `/coach/classes`, so My Members would light on all three surfaces. Working around that needs a hardcoded exclusion list of sibling routes, which silently rots the moment a fourth surface is added. The segment hook expresses the intent directly and needs no list.

- **`(dashboard)/page.tsx` is edited by both 17.1 and 17.3**, the heads of the epic's two parallel chains (`epics.md:656`). Whichever lands second must rebase, not overwrite. The invariant to preserve either way: the coach redirect stays **above** every data fetch in `OverviewData`. If 17.1 landed first, the shell read is already hoisted for its own reasons and this story's change is a two-line insertion.

- **The sidebar active-state fix is a shared-component change with blast radius beyond the Coach Portal.** It is in scope because without it this story ships a Portal where the sidebar goes dark on two of four routes, which is a worse navigation story than the one being fixed. The exact-match-wins rule is what keeps `/settings/staff` from lighting both Settings and Staff — verify that case specifically, it is the only place in `NAV_ITEMS` where one href prefixes another. Walked against all eleven items, the rule produces no wrong or ambiguous result. It does change the UI for every role in one benign way: a nav item now lights on child routes where nothing lit before (`/members/new`, `/settings/staff/<id>`). That is correct behaviour, not a regression — say so in the PR so a reviewer does not read it as one.

- **The `Fragment key={shell.gymId}` remount is a non-issue here, and a reviewer will ask.** `coach/layout.tsx` renders inside `children`, i.e. inside the keyed Fragment at `(dashboard)/layout.tsx:146`, so a gym switch remounts it with everything else. `CoachPortalNav` holds no state worth preserving, so this introduces no new staleness path and needs no second keying mechanism.

- **`shell.role` is a JWT claim, not a live DB read** (`session.ts:152-166`, `app_role`, minted by `0009_auth_hook_gym_claims.sql`). A user demoted to or from `coach` mid-session keeps their old landing behaviour until the token refreshes (up to `jwt_expiry`, 1 hour). This is the known, accepted AD-3 gap already recorded against ~30 other call sites in `deferred-work.md`; do not retrofit `private.current_member_role()` here — that is a separate, deliberately incremental effort, and the consequence here is a cosmetic landing-page choice, not an access grant.

- **The `?next=` deep-link path is not covered, deliberately.** `login-form.tsx:88-97` redirects to `?next=` when present and only falls back to `/`, and `lib/supabase/proxy.ts:80-87` sets that param when an unauthenticated request is bounced. So a Coach who deep-links to `/payments`, logs in, and is returned there is **not** sent to the Portal by this story's `page.tsx` redirect. That is the same accepted gap `coach/page.tsx` documents in the other direction (`coach/page.tsx:14-24`), it grants no access RLS does not already grant, and closing it would mean a role-aware guard on every dashboard route — out of scope, and no AC asks for it.

- **Sequencing: decided, and it constrains the release.** `sprint-change-proposal-2026-09-09.md` §3 ("Timeline and sequencing") explicitly contemplates shipping 17.1 and 17.3 alone if the onboarding date compresses, and names 17.4 as "depth, not a blocker". If that happens, the Portal's My Classes item points at the AC #11 shell. The two ways out are (a) ship 17.4 in the same release, or (b) hold the My Classes item out of the sub-nav until 17.4 lands. **Decided with the product owner on 2026-09-10: option (a).** 17.4 ships in the same release as 17.3 and is release-blocking, not depth; `epics.md`'s dependency-order paragraph carries the amendment. So this story ships all three sub-nav items per `EXPERIENCE.md:229-233` and FR-144, and AC #11's shell is expected to live only as long as it takes 17.4 to land behind it — it must never reach a customer. Two consequences to carry forward: 17.4 must not be deferred out of this release without revisiting this decision, and migration **0096 now deploys alongside 0095**, so the two go through the runbook together rather than as separate batches. If the release is ever cut before 17.4 anyway, the fallback is to hold the My Classes item out of `CoachPortalNav` — a one-line change — rather than ship the shell. `/coach/overview` has no equivalent risk: AC #10 makes it genuinely useful with zero new plumbing.

- **Why `/coach/overview` gets real content and `/coach/classes` does not.** Overview is the landing route — a Coach hits it on every sign-in, and it is reachable with one already-shipped, already-RLS-scoped call. My Classes needs the Coach's own `members.id` resolved server-side from `auth.uid()` + `private.gym_id()`, which is 17.4's AC#1 and pairs with migration 0096's roster RPC; doing it here would duplicate an AC across two stories and invite it being built twice or skipped in review.

- **This story modifies zero RLS policies and adds zero migrations** — the epic's stated boundary (`epics.md:658`). It also must not touch `mark_class_attendance`'s role check (`0068:41,70`) or `ClassesPageClient.tsx`'s `canMarkAttendance = role !== "coach"`. Note that `epics.md:734` cites that constant at `ClassesPageClient.tsx:55`; the real line is **58** for `canManage` and **65** for `canMarkAttendance`, and the file is at `app/(dashboard)/classes/components/ClassesPageClient.tsx`, not `classes/ClassesPageClient.tsx`.

- **Copy inconsistency worth surfacing, not silently changing.** `nav.coachPortal` is "Espace Coach" in French (`fr.json:13`) while `coachPortal.title` is "Portail Coach" (`fr.json:586`) — two French names for the same thing, and this story puts them one click apart (sidebar item → in-Portal heading). Leave both as shipped and flag it; changing customer-visible copy is a product call, not a dev-story side effect.

- **The i18n lint gate has a documented hole.** `eslint.config.mjs:22-38` records that `i18next/no-literal-string` runs in `jsx-text-only` mode, so its `jsx-attributes` exclude list is dead configuration and a hardcoded `aria-label` passes CI undetected. The sub-nav is exactly the kind of component that grows one. Don't write one.

- **`common.*` and `errors.*` do not live in `apps/dashboard/locales`.** They resolve from `packages/types/src/locales/{en,fr}.json`, deep-merged under the app's own file at `lib/i18n/get-server-translation.ts:42-45`. Tasks 5 and 6 render `t("common.loadError")` — do **not** add a duplicate `common` block to the app's locale files to "fix" a grep that comes back empty. `check-i18n-key-parity.mjs` walks all four locale directories, so the shared pair is covered too.

- **Testing:** Vitest 4.1.10 + `@testing-library/react` 16.3.2, jsdom, co-located `*.test.tsx`, `globals` **not** enabled (`vitest.setup.ts` registers `afterEach(cleanup)` manually and stubs `ResizeObserver`/`scrollIntoView`/`HTMLDialogElement`). Async Server Components are tested by awaiting the component function directly — see `(dashboard)/layout.gymSwitchRemount.test.tsx`'s `renderLayout()` helper and its in-file rationale. Playwright 1.62.1 specs live in `apps/dashboard/e2e/`.

- **Cite `docs/decisions.md` by its dated heading, never by line number** — the file is newest-first and every new entry shifts them.

### Project Structure Notes

- **New:** `apps/dashboard/app/(dashboard)/coach/layout.tsx`, `apps/dashboard/app/(dashboard)/coach/components/CoachPortalNav.tsx`, `apps/dashboard/app/(dashboard)/coach/overview/page.tsx` (+ optional `loading.tsx`), `apps/dashboard/app/(dashboard)/coach/classes/page.tsx`, `apps/dashboard/components/shared/Sidebar.test.tsx`, `apps/dashboard/app/(dashboard)/page.coachRedirect.test.tsx`.
- **Modified:** `apps/dashboard/app/(dashboard)/page.tsx`, `apps/dashboard/components/shared/Sidebar.tsx`, `apps/dashboard/services/session.ts`, `apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx` (remove the `<h1>` only), `apps/dashboard/app/(dashboard)/coach/loading.tsx` (drop the heading skeleton), `apps/dashboard/locales/en.json`, `apps/dashboard/locales/fr.json`.
- **Deliberate decision, not a default:** `apps/dashboard/app/(dashboard)/coach/[memberId]/loading.tsx:10` carries a heading placeholder (`h-6 w-40`) that becomes a second heading once the real `<h1>` renders from the layout. Decide it explicitly and record the choice in Completion Notes rather than leaving it untouched by omission.
- **Explicitly unmodified:** `Sidebar.tsx`'s `NAV_ITEMS` array, `(dashboard)/layout.tsx`, `coach/page.tsx`, `coach/[memberId]/page.tsx` and its `components/**`, `classes/components/ClassesPageClient.tsx`, `proxy.ts`, `lib/supabase/proxy.ts`, every migration and every RLS policy.
- `coach/components/` already exists (`CoachPortalPageClient.tsx` lives there), so the nav component follows the established per-route `components/` convention rather than introducing a new folder. `coach/layout.tsx` is the app's first nested layout inside `(dashboard)`; `(dashboard)/layout.tsx`'s own sync-shell + Suspense-wrapped-async-child shape is the pattern to follow if the layout ever needs a dynamic read It does not need its own split only because `(dashboard)/layout.tsx:17`'s `<Suspense fallback={null}>` already wraps `children`, and therefore this layout, in an ancestor boundary. Its `await getServerTranslation(await getRequestLocale())` is **not** I/O-free — `getRequestLocale()` (`get-request-locale.ts:24-48`) does `supabase.auth.getClaims()` over cookies plus a `users` SELECT plus `headers()`. Do not remove or narrow that ancestor boundary: `spec-cache-components-suspense-boundary-fix.md` records that an unbounded `getRequestLocale()` in a layout hard-fails a real `next build`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 17.3: Coach Portal — Sub-Navigation & Landing]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 17 — scope boundary; :656 two-chain sequencing]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-09.md §2 (Story impact), §4.2 (routing decision), §4.4]
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:429 FR-053 (amended), :555 FR-144, :775 FR-122 (amended)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:85-86 (AD-20/AD-21 registry), :151-154 (nav tree), :204, :225-235 (role matrix + sub-nav), :1755-1790 (AD-20), :1792-1810 (AD-21), :1035 (post-login destination)]
- [Source: _bmad-output/implementation-artifacts/5-2-coach-portal-assigned-member-list.md:55 — AC#1 recorded as satisfied by inspection, never tested]
- [Source: _bmad-output/implementation-artifacts/spec-cache-components-suspense-boundary-fix.md]
- [Source: apps/dashboard/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-selected-layout-segment.md]
- [Source: apps/dashboard/AGENTS.md; apps/dashboard/next.config.ts:6-9]
- [Source: apps/dashboard/app/(dashboard)/page.tsx:24-67]
- [Source: apps/dashboard/app/(dashboard)/layout.tsx:1-2,11-21,41,107-120,146]
- [Source: apps/dashboard/app/(dashboard)/coach/page.tsx:9-24,26-63]
- [Source: apps/dashboard/app/(dashboard)/coach/[memberId]/page.tsx:11-21,50-58]
- [Source: apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx:102-104,169-176,199]
- [Source: apps/dashboard/components/shared/Sidebar.tsx:26-52,78,108,119-121]
- [Source: apps/super-admin/components/AdminNavLink.tsx — pathname-derived active nav link, aria-current, client/server split]
- [Source: apps/dashboard/services/session.ts:38,44,47-73,117-127,129-133,152-166]
- [Source: apps/dashboard/services/coaches.ts:164-176,227-261]
- [Source: apps/dashboard/lib/i18n/get-request-locale.ts:24 — React cache() precedent]
- [Source: apps/dashboard/components/login-form.tsx:88-97; apps/dashboard/lib/supabase/proxy.ts:80-87 — the ?next= path]
- [Source: apps/dashboard/app/(dashboard)/layout.gymSwitchRemount.test.tsx — async Server Component test technique + redirect mock]
- [Source: apps/dashboard/app/(dashboard)/members/components/MembersPageClient.sendInvite.test.tsx:28 — usePathname mock shape]
- [Source: apps/dashboard/vitest.config.mts; apps/dashboard/vitest.setup.ts]
- [Source: apps/dashboard/eslint.config.mjs:16-79; scripts/check-i18n-key-parity.mjs]
- [Source: apps/dashboard/locales/en.json:2-14,585-626; apps/dashboard/locales/fr.json:2-14,585-626]
- [Source: apps/dashboard/e2e/progress-data-privacy.spec.ts:106]
- [Source: supabase/migrations/0009_auth_hook_gym_claims.sql — app_role claim origin]
- [Source: supabase/migrations/0057_class_creation_scheduling.sql:101 — gym_staff_read_own_classes has no role check (Finding 3)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (`claude-opus-5[1m]`) via Claude Code, `bmad-dev-story` workflow.

### Debug Log References

- Red → green per task, each via `npx vitest run <file>`: the Task 1 redirect test was 7/8 red before the change (the no-shell case already passed), then 8/8; `Sidebar.test.tsx` was 5/14 red — exactly the child-route active-state cases; the role-matrix cases already passed, as expected for a first test of shipped Story 5.2 behaviour — then 14/14; `CoachPortalNav` + `coach/layout` tests were red on missing modules, then 9/9; `/coach/overview` test red, then 6/6; `/coach/classes` test red, then 1/1.
- Baseline before any change: 43 files / 339 tests green. Final: `pnpm --filter @gymos/dashboard test` 49 files / 377 tests green (38 new); `typecheck` exit 0; `lint` exit 0 with 15 warnings, none in a file this story touches (eslint output filtered to touched paths: 0 matches); `node scripts/check-i18n-key-parity.mjs` clean (dashboard 761 keys); `pnpm --filter @gymos/dashboard build` exit 0, with `/coach`, `/coach/overview`, `/coach/classes` and `/coach/[memberId]` all Partial Prerender (◐).

### Completion Notes List

- **AC #1/#2 — two boundaries on `/`, a deliberate reading of AC #2 now that Story 17.1 has landed.** 17.1 shipped a stat-card skeleton as `OverviewPage`'s fallback, and AC #2 says a Coach must see neither staff copy nor that skeleton. One `null` fallback would have taken 17.1's AD-02 loading state away from staff; keeping the skeleton would flush it to every Coach before the client-side bounce. So: `OverviewPage` → `<Suspense fallback={null}>` → `OverviewGate` (reads the shell, redirects a Coach, nothing else) → `<Suspense fallback={<OverviewSkeleton />}>` → `OverviewData({ shell })`. The redirect runs before `getRequestLocale()` and before the `Promise.all`, which no longer contains `getDashboardShellContext()` and takes the resolved `shell` as a prop. `page.overview.test.tsx`'s helper now awaits both async children; its 13 assertions are unchanged.
- **AC #3:** `getDashboardShellContext` is now `export const … = cache(async () => …)`, the same form as `getRequestLocale`. `layout.gymSwitchRemount`, `session.switchActiveGym`, `session.getDashboardShellContext` and `members/actions.sendMemberInvite` tests re-run green (22/22).
- **AC #4/#5:** `NAV_ITEMS` untouched. `resolveActiveHref()` runs once over the role-filtered hrefs: exact match, else the longest `href + "/"` prefix, with `/` never a prefix. Task 3's "manually confirm" cases are pinned in `Sidebar.test.tsx` (`/`, `/members/new`, `/settings/staff`, `/settings`, `/settings/staff/<id>`, `/membersarchive`, and all four Coach Portal routes); smartsana's browser pass can spot-check them too. **PR note owed:** every role now sees a lit item on child routes (`/members/new`, `/settings/staff/<id>`) where nothing lit before — correct behaviour, not a regression.
- **AC #6–#9, #13:** `coach/layout.tsx` is an async Server Component rendering `<h1>` → `<Suspense fallback={<CoachPortalNavFallback />}><CoachPortalNav /></Suspense>` → `children`. `CoachPortalNav` reads `useSelectedLayoutSegment()`: `overview` and `classes` light their own items, anything else (`null`, a member UUID) lights My Members; `aria-current="page"` lands on exactly one link; classes are AdminNavLink's active/inactive pair. The fallback is three text-free `h-5 w-20` placeholders. Because `next build` passes with or without the nested boundary (the ancestor `fallback={null}` satisfies it), `coach/layout.test.tsx` asserts it on the element tree — the nav sits in its own `Suspense` whose fallback is `CoachPortalNavFallback`, not `null`.
- **`coach/[memberId]/loading.tsx:10` — decided: left unchanged.** Its `h-6 w-40` bar is not a page-heading placeholder. It sits in the second block, below the `h-24` member-card placeholder, standing in for the section heading of the notes area — `CoachMemberDetailPageClient.tsx:133-147` opens with the member card and has no page heading. With the real `<h1>` now rendering above it from the layout, the skeleton reads heading → sub-nav → member card → section, which matches the loaded page, so there is no double heading to remove. `coach/loading.tsx`'s `h-8 w-40` *was* the page-heading placeholder and is removed; its wrapper collapsed to the 4-row list.
- **AC #10:** `/coach/overview` renders My Members At A Glance from one `listAssignedMembers({})` call: the locale-formatted total, then one `Badge` per status using `STATUS_BADGE_CONFIG`'s `members.status.*` labels and icons (zero-count statuses omitted), and "All →" → `/coach`. Label and count sit side by side rather than as a composed "9 active" sentence, which would not inflect correctly in French. No assignments → the existing `coachPortal.emptyNoAssignments`, in AD-14's dashed box; a failed read → inline `common.loadError`. A sibling `overview/loading.tsx` (one widget-card skeleton) stops AD-14's member-list rows being the fallback while navigating there. **Bookkeeping done in the same change:** `epics.md` Story 17.5 amended — the At-A-Glance and no-assignments ACs removed, the "four widgets" and "other three still render" ACs reworded, and an amendment note added telling 17.5 to keep 17.3's empty state covering the whole page; the transfer is recorded in `sprint-status.yaml`.
- **AC #11:** `/coach/classes` renders one neutral note (`coachPortal.classes.pendingNote`) behind a `null` fallback, with a header comment naming Story 17.4 as the owner and restating the release decision (17.4 ships in the same release; otherwise hold My Classes out of `CoachPortalNav`). No query, no `members.id` resolution, no AD-21 empty state — pinned by `classes/page.test.tsx`.
- **AC #12:** the route tree only gains static siblings `overview/` and `classes/` next to `[memberId]/`; `coach/page.tsx` and `coach/[memberId]/**` are untouched, as are the three `router.push(`/coach/${row.memberId}`)` calls. `e2e/progress-data-privacy.spec.ts:106` re-read against the new tree: it does `page.goto('/coach/<memberId>')` then `getByRole("tab", { name: "Progress" })` — the sub-nav adds links, not tabs, none named Progress — and its `.grid img` locator is unaffected, since the layout adds no `.grid`. `loginViaUi` only asserts the URL has left `/auth/login`, so a Coach fixture landing on `/coach/overview` does not break it. The e2e suite was not run locally; CI's `e2e-tests` job runs it on the PR.
- **AC #14:** no role guard added anywhere.
- **AC #17:** `coachPortal.subNav.{overview,myMembers,myClasses}`, `coachPortal.overview.membersAtAGlance.{title,assignedLabel,viewAll}` and `coachPortal.classes.pendingNote` in both locales, with real French — `Aperçu` / `Mes membres` / `Mes cours` follow the existing `nav.overview` ("Aperçu") and `nav.classes` ("Cours"). No duplicate `common` block added.
- **Flagged, not changed (both in `deferred-work.md`):** the AD-15 breadcrumb (`← Coach Portal / [Member Name]`), deferred per AC #13; and `nav.coachPortal` "Espace Coach" vs `coachPortal.title` "Portail Coach", left for a product copy decision.
- **Scope held:** no migration, no RLS change; `(dashboard)/layout.tsx`, `proxy.ts`, `ClassesPageClient.tsx` and `NAV_ITEMS` untouched. Nothing committed — the work is on branch `feat/17-3-coach-portal-nav`.
- **Worth checking in smartsana's browser pass:** sign in as a Coach → land on `/coach/overview` with no Overview skeleton or staff heading flashing first; heading + sub-nav on all four Portal routes, with Coach Portal lit in the sidebar on each; My Members lit on a member's detail page; `/coach/classes` shows the note; EN/FR labels. As an Owner: `/members/new` lights Members, `/settings/staff` lights only Staff.

### File List

New:
- `apps/dashboard/app/(dashboard)/coach/layout.tsx`
- `apps/dashboard/app/(dashboard)/coach/layout.test.tsx`
- `apps/dashboard/app/(dashboard)/coach/components/CoachPortalNav.tsx`
- `apps/dashboard/app/(dashboard)/coach/components/CoachPortalNav.test.tsx`
- `apps/dashboard/app/(dashboard)/coach/overview/page.tsx`
- `apps/dashboard/app/(dashboard)/coach/overview/page.test.tsx`
- `apps/dashboard/app/(dashboard)/coach/overview/loading.tsx`
- `apps/dashboard/app/(dashboard)/coach/classes/page.tsx`
- `apps/dashboard/app/(dashboard)/coach/classes/page.test.tsx`
- `apps/dashboard/app/(dashboard)/page.coachRedirect.test.tsx`
- `apps/dashboard/components/shared/Sidebar.test.tsx`

Modified:
- `apps/dashboard/app/(dashboard)/page.tsx`
- `apps/dashboard/app/(dashboard)/page.overview.test.tsx`
- `apps/dashboard/components/shared/Sidebar.tsx`
- `apps/dashboard/services/session.ts`
- `apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx`
- `apps/dashboard/app/(dashboard)/coach/loading.tsx`
- `apps/dashboard/locales/en.json`
- `apps/dashboard/locales/fr.json`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/17-3-coach-portal-sub-navigation-landing.md`

Code review (2026-09-10):
- New: `apps/dashboard/app/(dashboard)/coach/classes/loading.tsx`, `apps/dashboard/components/shared/GymSwitcher.test.tsx`, `apps/dashboard/components/shared/SuspendedGymScreen.switchGym.test.tsx`
- Modified: `apps/dashboard/components/shared/GymSwitcher.tsx`, `apps/dashboard/components/shared/SuspendedGymScreen.tsx`, `apps/dashboard/components/update-password-form.tsx` (comment only), `apps/dashboard/app/(dashboard)/layout.tsx` (comment only; the gymId key is unchanged), `apps/dashboard/app/(dashboard)/layout.gymSwitchRemount.test.tsx` (comment only), plus further edits to `page.tsx`, `page.coachRedirect.test.tsx`, `CoachPortalNav.tsx`, `CoachPortalNav.test.tsx`, `en.json`, `fr.json`, `epics.md`, `deferred-work.md` and `sprint-status.yaml`

## Change Log

- 2026-09-10 — dev-story: Story 17.3 implemented (Tasks 1–9). Coach redirect on `/` behind a null-fallback gate boundary, with 17.1's skeleton kept on an inner staff-only boundary; `getDashboardShellContext` memoized with `cache()`; Sidebar active state is exact-match-else-longest-prefix; new `coach/layout.tsx` with the Portal heading and `CoachPortalNav` in its own Suspense boundary; `/coach/overview` (My Members At A Glance) and `/coach/classes` (route shell for 17.4); EN/FR keys; 6 new test files (38 tests). `epics.md` Story 17.5 amended to hand the At-A-Glance widget and empty state to 17.3; two items added to `deferred-work.md`. Status → review.
- 2026-09-10 — code-review: three parallel review layers; no AC violated. 2 decisions resolved: the `/` gate boundary now has a role-neutral skeleton, and a gym switch now always lands on `/` via a full navigation, from both switchers. 5 patches applied, 2 findings deferred to `deferred-work.md`, 20 dismissed. Full suite 51 files / 382 tests green, typecheck 0, lint 0 errors, i18n parity clean, `next build` exit 0. Status → done.
- 2026-09-10 — manual QA: smartsana's browser pass on the local Overview QA Gym reported all passing — Coach sign-in lands on `/coach/overview` with no staff content flashing first; My Members At A Glance shows 7 = 3 active / 2 expiring soon / 1 grace period / 1 expired, with the ended assignment excluded; the no-assignments coach sees `coachPortal.emptyNoAssignments`; heading and sub-nav on all four Portal routes with the right item lit, and Coach Portal lit in the sidebar; My Classes shows only its note; owner child-route highlighting (`/members/new`, `/settings/staff`); receptionist unaffected; EN/FR. Not exercisable with the QA accounts: a gym switch landing on `/`, since every QA account belongs to one gym.
