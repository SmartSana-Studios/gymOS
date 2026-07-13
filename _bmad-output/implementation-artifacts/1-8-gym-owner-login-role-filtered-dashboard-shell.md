---
baseline_commit: 223e66b7562ffdf2ee151534fa387abc96fdaddb
---

# Story 1.8: Gym Owner Login & Role-Filtered Dashboard Shell

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Gym Owner, Manager, Receptionist, or Coach,
I want to log into my gym's admin dashboard and see only the navigation my role permits,
so that I can access exactly the tools relevant to my job.

## Acceptance Criteria

1. **Given** valid email/password credentials, **When** I log in, **Then** I land on the Overview page with a sidebar showing only the nav items my role can access (absent, not disabled, for inaccessible items). [Source: epics.md#Story 1.8]
2. **Given** invalid credentials, **When** I submit the login form, **Then** an inline error appears below the password field, **And** no session is created. [Source: epics.md#Story 1.8]
3. **Given** I am logged in as a Coach, **When** the dashboard renders, **Then** only the "Coach Portal" link appears in the sidebar. [Source: epics.md#Story 1.8]

## Tasks / Subtasks

- [x] **Task 1: Migration `0013_dashboard_shell_self_read.sql`** (AC: #1, #3)
  - [x] Add RLS `SELECT` policy `self_read_own_membership` on `members`: `using (user_id = auth.uid())`. **This is a real gap, not a formality**: `members` has had RLS enabled with zero business policies since `0003_members_and_users.sql` — Stories 1.5–1.7 only ever added Super-Admin-scoped policies (`super_admin_insert_owner_member`, `super_admin_read_owner_members`, `super_admin_escalated_read_members`). No policy today lets a regular gym-scoped session (owner/manager/receptionist/coach) read even its own row. This story's Sidebar/top-of-page identity display (user's own name + role) needs one. Scoped to exactly one row (`user_id = auth.uid()`), not a roster-browsing policy — reading *other* members is Epic 2's job (FR-019–023), not this story's.
  - [x] No policy needed on `gyms` — `"read own gym"` (`id = private.gym_id()`) already exists from `0009_auth_hook_gym_claims.sql` and covers the gym-name display.
  - [x] No policy needed on `users` — do not add one. See Dev Notes → "`users.display_name` is dead data" below for why this story deliberately does not read from `users` at all.
  - [x] Record this migration's rationale in `docs/decisions.md` per Task 13.

- [x] **Task 2: `packages/types` — login schema** (AC: #2)
  - [x] New file `packages/types/src/schemas/auth.ts`: `loginSchema = z.object({ email: z.email("Enter a valid email address"), password: z.string().min(1, "Enter your password") })`. Client-side submit-time feedback only (UX-DR11: validate on submit only) — the actual credential check is Supabase Auth's `signInWithPassword`, which is the true source of truth for "invalid credentials"; this schema only catches empty/malformed input before that call fires.
  - [x] Export from `packages/types/src/index.ts` (add `export * from "./schemas/auth";` alongside the existing `gym`/`tier`/`errors` exports).

- [x] **Task 3: `apps/dashboard/services/session.ts` — new service file** (AC: #1, #3)
  - [x] First service file in this app (no `services/` directory exists yet — architecture.md's directory structure names this exact path). Follow `apps/super-admin/services/gyms.ts`'s established shape: a local `mapAndLog(rawError)` wrapper over `@gymos/types`'s `mapSupabaseError` (this app has no shared `mapAndLog` to import — each app keeps its own copy per the architecture's "services are not shared across apps" boundary).
  - [x] `getDashboardShellContext(): Promise<{ data: { gymName: string; memberName: string; role: MemberRole } | null; error: AppError | null }>` — reads `gym_id`/`app_role` from `supabase.auth.getClaims()` (not `getUser()` — matches this codebase's established convention, see Story 1.7's Review Findings on why `getClaims()` is preferred), then in parallel: `supabase.from('gyms').select('name').eq('id', gymId).single()` (uses the existing `"read own gym"` policy) and `supabase.from('members').select('name').eq('gym_id', gymId).eq('user_id', <claims.sub>).is('deactivated_at', null).maybeSingle()` (uses Task 1's new self-read policy). Returns `role` straight from the `app_role` claim — no DB round-trip needed for it, since RLS/the claims hook is already the authoritative source.
  - [x] If the `members` row lookup returns null (edge case: claims are stale relative to a mid-session deactivation), fall back to `claims.email` for display rather than erroring the whole page — this is a display nicety, not a security boundary; RLS on every other table still enforces access correctly regardless of what name renders in the corner.

- [x] **Task 4: Wire `DESIGN.md`'s brand tokens into `apps/dashboard/app/globals.css`** (AC: #1, #3)
  - [x] This is the **first story to ship any real GymOS-branded UI** in `apps/dashboard` — the `:root` block still carries shadcn's generic starter palette (`--primary: 0 0% 9%` near-black, `--accent: 0 0% 96.1%` light gray), not `DESIGN.md`'s three tokens. Update `:root` only (no spec exists for a dark-mode variant of GymOS's brand — leave `.dark` untouched, out of scope):
    - `--background: 60 23% 97%;` (`#FAFAF7`)
    - `--primary: 216 41% 18%;` (`#1B2A41`) — keep `--primary-foreground` at its existing near-white default (`0 0% 98%`), which already reads correctly on navy.
    - `--accent: 37 76% 50%;` (`#E0971F`) — keep `--accent-foreground` at its existing near-black default (`0 0% 9%`), which already reads correctly on amber.
  - [x] Do not touch `--foreground`, `--secondary`, `--muted`, `--destructive`, or any `.dark` value — `DESIGN.md` specifies exactly three tokens and nothing else; inventing values for the rest is scope creep this story doesn't need.

- [x] **Task 5: Rebuild AD-01 login** (AC: #1, #2)
  - [x] `apps/dashboard/components/login-form.tsx` — currently the unmodified `create-next-app -e with-supabase` tutorial form (generic "Login" heading, links to `/auth/sign-up`, no error-copy matching AD-01). Rewrite to match AD-01's spec exactly:
    - Card layout, max 400px, centered (`EXPERIENCE.md#AD-01`).
    - Heading: static `"Sign in to GymOS"` (resolved Dev Notes → Open Question 1 — no pre-auth gym context exists to interpolate a gym name).
    - "Email address *" / "Password *" labeled inputs; password field gets a show/hide toggle (not present in the current scaffold — add one, e.g. an eye icon `Button` toggling `type="password"`/`type="text"`).
    - Submit on Enter from either field (native `<form>` behavior already provides this — do not add a manual keydown handler).
    - On submit: spinner + disabled button (`isLoading` state, already present in the scaffold — keep).
    - Error states, exact copy from `EXPERIENCE.md#AD-01`: invalid credentials → `"Email or password is incorrect."` inline below the password field (AC #2's literal requirement); account locked → `"Your account has been locked. Contact your gym administrator."`; network error → `"Couldn't connect. Check your internet connection."` above the button. Map Supabase Auth's `signInWithPassword` error to these three cases (GoTrue returns a distinguishable `error.code`/`error.status` for invalid-grant vs. network failure — a locked-account case has no current server-side mechanism in this codebase, so that branch is unreachable/dead in practice for V1; keep the copy ready but do not invent a locking mechanism to make it reachable).
    - **Remove** the "Don't have an account? Sign up" link entirely — FR-007 (founder-assisted onboarding only, no self-serve signup) makes it actively wrong for this app. Do not delete the underlying `/auth/sign-up` route/files (out of scope, harmless dead code — flag in Dev Agent Record if left as-is).
    - On success: redirect to the `next` search param if present (see below), else `/`.
  - [x] `apps/dashboard/app/auth/login/page.tsx` — no structural change needed beyond passing through a `next` search param to the form (Next.js 16 `page.tsx` receives `searchParams` as a prop; thread it to `<LoginForm redirectTo={...} />`). **Patched during implementation**: `searchParams` is read inside a `<Suspense>`-wrapped inner component, not the top-level page — Next.js 16's Cache Components mode requires dynamic APIs like `searchParams` to resolve inside a Suspense boundary (confirmed via a real console error caught during Playwright verification), matching `apps/super-admin/app/(admin)/gyms/[id]/page.tsx`'s existing outer-sync/inner-async-Suspense pattern.
  - [x] `apps/dashboard/lib/supabase/proxy.ts` (the middleware, via `apps/dashboard/proxy.ts`) — when redirecting an unauthenticated request to `/auth/login`, append `?next=<original pathname>` so a deep link (e.g. a bookmarked `/members` URL) round-trips back after login, matching AD-01's own Interactions spec ("redirect to AD-02 or originally-requested deep link").

- [x] **Task 6: Fix the middleware's `/` exemption** (AC: #1)
  - [x] `apps/dashboard/lib/supabase/proxy.ts` line ~50 currently reads `request.nextUrl.pathname !== "/" && !user && ...` — the starter scaffold deliberately left `/` unprotected because `/` was a public marketing page. That's no longer true: `/` is now AD-02 Overview, a protected route (`EXPERIENCE.md#AD-02` route table: `/`, min role Receptionist). Remove the `pathname !== "/"` clause so `/` is redirected to `/auth/login` like every other unauthenticated route.
  - [x] This is defense-in-depth, not the sole gate — `app/(dashboard)/layout.tsx` (Task 7) is the authoritative claims check, mirroring `apps/super-admin/app/(admin)/layout.tsx`'s exact established pattern (middleware catches the coarse "no session at all" case; the layout Server Component catches the fine-grained "wrong role/no gym_id" case).

- [x] **Task 7: `app/(dashboard)/layout.tsx` — the role-gate + shell** (AC: #1, #3)
  - [x] New route group `apps/dashboard/app/(dashboard)/`. `layout.tsx`: Server Component, calls `supabase.auth.getClaims()`. Redirect to `/auth/login` if claims are absent, **or** if `claims.gym_id`/`claims.app_role` are both absent (mirrors `(admin)/layout.tsx`'s "hard security boundary" comment almost exactly, but inverted: this guard exists specifically to keep a `super_admin`-only session — which has `app_role` but no `gym_id` — out of the gym-scoped dashboard, the symmetric case to super-admin's own guard against gym staff reaching `/gyms`). Call `getDashboardShellContext()` (Task 3) once here and pass its result down to `<Sidebar>`/`<TopBar>` as props — do not re-fetch it per-page.
  - [x] Renders `<Sidebar role={role} gymName={gymName} memberName={memberName} />` (Task 8) and a content area; `{children}` renders inside. **Implementation detail beyond the story's literal text**: a new `components/shared/DashboardChrome.tsx` client component (not separately enumerated in Task 8) owns the mobile-nav-open boolean shared between the Sidebar overlay and TopBar's hamburger toggle, and composes `<Sidebar>` + `<TopBar>` + the content area — required to coordinate the two without prop-drilling through this Server Component; `layout.tsx` renders `<DashboardChrome>` rather than `<Sidebar>` directly.

- [x] **Task 8: `components/shared/Sidebar.tsx` (+ `TopBar.tsx`)** (AC: #1, #3)
  - [x] `apps/dashboard/components/shared/Sidebar.tsx` (new; `components/shared/` doesn't exist yet in this app — architecture.md names this exact path for `FrontDeskAlertPanel`/`InlineRenewalPanel`/`Sidebar`, this story ships the first of the three). Client Component (needs `usePathname()` for active-link state). Structure exactly per `EXPERIENCE.md` lines 171–200:
    - Top: GymOS logo (32px) + gym name (truncate at 200px) + divider.
    - Middle: role-filtered nav links, hard-coded from the **Role visibility matrix** table (`EXPERIENCE.md` line 187 — reproduce verbatim, do not derive a numeric "role level" abstraction that isn't in the spec):

      | Nav item | href | Receptionist | Manager | Owner | Coach |
      |---|---|---|---|---|---|
      | Overview | `/` | ✓ | ✓ | ✓ | — |
      | Members | `/members` | ✓ | ✓ | ✓ | — |
      | Subscriptions | `/subscriptions` | — | ✓ | ✓ | — |
      | Payments | `/payments` | ✓ | ✓ | ✓ | — |
      | Attendance | `/attendance` | ✓ | ✓ | ✓ | — |
      | Audit Log | `/audit` | — | ✓ | ✓ | — |
      | Settings | `/settings` | — | — | ✓ | — |
      | Coach Portal | `/coach` | — | — | — | ✓ |

      A Coach session renders **only** the Coach Portal link — every other item is absent from the DOM (AC #3's literal wording: "absent," not `disabled`/hidden-via-CSS). Implement as a filter over the table above keyed on the `role` prop, not per-role conditional JSX blocks.
    - Bottom: divider, then avatar placeholder + `memberName` + role pill (`Badge` component, `apps/dashboard/components/ui/badge.tsx` already exists from the starter — use it, do not build a new pill component), then a Logout control.
    - Active-page state: 3px left-border accent, bold label (`EXPERIENCE.md` line 183) — use the new `--accent` token from Task 4.
    - Responsive per `EXPERIENCE.md` lines 1893–1906: 240px fixed ≥1024px; 64px icon rail 768–1023px (icons + hover tooltip, no labels); hidden by default <768px, revealed as a left overlay with backdrop via the `TopBar`'s hamburger toggle.
    - **Do not build the "EN | FR" language toggle.** UX-DR shows it in this exact spot, but bilingual support (FR-014–018) is Story 1.10's explicitly-scoped work, and there is no i18n library wired into this app yet — a toggle with nothing to toggle is a half-finished implementation. Leave the space for it; Story 1.10 adds the control.
  - [x] `apps/dashboard/components/shared/TopBar.tsx` (new) — a slim bar at the top of the content area (not inside the sidebar). Its only jobs in this story: host the hamburger (`☰`) toggle that opens the Sidebar as an overlay at <1024px (`EXPERIENCE.md` line 1895/1905 — this is the one part of "top bar" that's genuinely a separate element from the Sidebar, needed only for the responsive collapse case), and a page-title slot. Do **not** duplicate gym name / user name / role pill here — those already live in the Sidebar's own top/bottom sections per the detailed Navigation Structure spec (lines 171–200); the one-line "top bar (gym name + logged-in user name + role pill)" mention at line 846 is a summary of the Sidebar's content, not a second, separate identity display — building both would be redundant UI showing the same three facts twice.
  - [x] Logout: a `<dialog>`-based confirmation, same native-`<dialog>`/`showModal()` pattern as `GymLifecycleDialog.tsx`/`EscalateAccessDialog.tsx` (no `Dialog` primitive exists in `components/ui/` in this app either — don't add one). Copy exactly: `"Log out of GymOS?"` with `[Log out]` `[Cancel]` (`EXPERIENCE.md` line 200). On confirm, `supabase.auth.signOut()` then `router.push("/auth/login")` — same effect as the existing `logout-button.tsx`, but that component has no confirmation step and doesn't match this spec, so build the confirm-then-sign-out flow directly inside the new Sidebar rather than reusing/wrapping `logout-button.tsx`. **Patched during implementation**: `logout-button.tsx` itself became fully orphaned once `auth-button.tsx` (its only caller) was deleted in Task 10 — deleted alongside it rather than left as dead code.

- [x] **Task 9: `app/(dashboard)/page.tsx` — Overview shell** (AC: #1)
  - [x] Resolved (Dev Notes → Open Question 2): a minimal Overview page — page heading "Overview" and a short placeholder — with **no** stat cards, tables, or Front-Desk Alert Panel. Do not query `subscriptions`, `attendance_events`, or `payments` from this page: all three tables have RLS enabled with **zero** business policies for a gym-scoped role today (confirmed via `0004_subscriptions_and_plans.sql`, `0005_payments.sql`, `0006_attendance.sql` — deny-all since creation, awaiting their owning epics' policies), so any such query would silently return 0 rows regardless of real gym activity — building the full styled empty-state UI now would look authoritative while actually being blocked on RLS that doesn't exist yet.

- [x] **Task 10: Remove superseded starter/tutorial scaffold** (housekeeping — prevents dead code from confusing a future dev agent)
  - [x] Delete `apps/dashboard/app/page.tsx` — it currently owns route `/` (the tutorial marketing/hero page) and **must** be removed regardless of Task 9's placement, since `app/(dashboard)/page.tsx` (a route group) also resolves to `/` — Next.js will error on two `page.tsx` files resolving to the same route otherwise.
  - [x] Delete `apps/dashboard/app/protected/` (`layout.tsx` + `page.tsx`) — the tutorial's "protected page" demo, fully superseded by `app/(dashboard)/`.
  - [x] Delete the components that become orphaned once the two routes above are gone (verified via grep — each is used **only** by `app/page.tsx` and/or `app/protected/`): `components/hero.tsx`, `components/deploy-button.tsx`, `components/next-logo.tsx`, `components/supabase-logo.tsx`, `components/theme-switcher.tsx`, `components/tutorial/` (entire directory: `code-block.tsx`, `connect-supabase-steps.tsx`, `fetch-data-steps.tsx`, `sign-up-user-steps.tsx`, `tutorial-step.tsx`).
  - [x] Keep `components/env-var-warning.tsx` and `components/auth-button.tsx` only if still referenced after the above deletions — re-check with a grep before deleting; do not delete on assumption. **Re-checked via grep: neither was referenced anywhere else — both deleted.** This cascaded to `components/logout-button.tsx` (only caller was `auth-button.tsx`), also deleted (see Task 8 patch note).
  - [x] `apps/dashboard/app/layout.tsx`: update `metadata.title`/`metadata.description` from the generic "Next.js and Supabase Starter Kit" copy to GymOS-appropriate values (e.g. `"GymOS"` / `"Gym management dashboard"`) — leave the `ThemeProvider`/`next-themes` wrapper as-is (unrelated, no GymOS spec calls for removing it, and it's inert either way).

- [x] **Task 11: pgTAP tests** (AC: #1, #3)
  - [x] New file `supabase/tests/dashboard_shell_self_read_rls.test.sql`, session-simulation conventions matching `gym_data_escalation_rls.test.sql` (seed all fixtures up front as the connecting role, then `set local role authenticated` + `set_config('request.jwt.claims', ...)` per simulated session):
    - An `owner`-claim session sees exactly 1 row from `members where user_id = <own auth.uid()>` (their own row) and 0 rows for a different user's `user_id` at the same gym (regression: this policy must not accidentally become a roster-read).
    - A `coach`-claim session likewise sees only its own row, not the gym's owner/manager rows.
    - Cross-tenant regression: a session claimed for Gym A sees 0 rows when querying `members` filtered to a Gym B user_id, even their own historical row at a different gym if one exists (self-read is not "any row this user_id ever had," it's scoped correctly by the query's own `gym_id`/`user_id` filter working in combination with RLS, not RLS alone providing tenant scoping here — note this explicitly in a test comment since `self_read_own_membership`'s `using` clause has no `gym_id` check by design, matching `private.gym_id()`'s "not needed, the row's own scope is the check" reasoning only if the row is filtered by `user_id`; confirm this doesn't accidentally let a user see a *different gym's* row of their own history that the JWT's `gym_id` claim doesn't correspond to — if it does, that's expected: the row belongs to them, just not the currently-active gym context; the Sidebar's own query in Task 3 already filters `.eq('gym_id', gymId)` so the UI never surfaces it, but the RLS policy itself intentionally does not narrow by `gym_id`. Assert this exact shape rather than assuming it away.)
  - [x] Run `supabase test db` against local Docker Postgres (WSL2 quirk documented below) — confirm all assertions pass, old and new (112+ baseline from Story 1.7). **Found a real regression, not a formality**: adding `self_read_own_membership` legitimately changed the expected result of two pre-existing tests (`gyms_super_admin_rls.test.sql`, `rls_tenant_isolation.test.sql`), both of which asserted the old deny-all behavior for an owner/member session querying `members`. Both updated to assert exactly 1 visible row (their own) — see Dev Agent Record → Debug Log References. Final run: 119/119 assertions passing (112 baseline + 6 new + 1 added assertion).

- [x] **Task 12: Manual end-to-end verification** (AC: #1, #2, #3 — this project's standard for application-layer/UI logic pgTAP can't exercise)
  - [x] Real GoTrue login as an `owner` test account (reuse or create one the same way Stories 1.5–1.7's verification scripts did — via `admin.auth.admin.createUser` + a known password, or Supabase's local test-OTP/password path). Confirm: (a) valid credentials land on `/` (Overview) with the full nav for Owner; (b) wrong password shows `"Email or password is incorrect."` inline below the password field and creates no session (check no auth cookie is set); (c) `/` is unreachable without a session (redirects to `/auth/login`).
  - [x] Repeat login as a `receptionist` and confirm Subscriptions/Audit Log/Settings are absent from the DOM (inspect rendered HTML, not just visually — AC #1's "absent, not disabled" is a DOM assertion).
  - [x] Repeat as a `coach` and confirm **only** "Coach Portal" renders (AC #3, literal).
  - [x] Resize/emulate viewport at 1024px, 768px, and 375px and confirm the Sidebar collapses to icon-rail then hamburger-overlay per the responsive spec (Task 8).
  - [x] `next build` to confirm no RSC/Server Action/Suspense regressions (matches Stories 1.5–1.7's precedent; a full HTTP cookie-based check isn't needed here since Task 6/7 don't introduce new Suspense boundaries beyond what `(admin)/layout.tsx`'s pattern already proved works). **Went further than the story's literal ask**: unlike Stories 1.5–1.7 (DB/GoTrue-level verification only, no browser), a real headless-Chromium (Playwright) session was launched against a running `next dev` server for this story, since Task 12's own checks are explicitly DOM/viewport-level (browser automation wasn't available via the `run` skill's default `chromium-cli` path in this environment, so Playwright + Chromium were installed on demand). This is what caught the real Suspense/searchParams bug (see Task 5's patch note) — a DB-level-only check would have missed it entirely. 38 real-browser assertions across all 3 roles (nav DOM presence/absence, viewport breakpoints, console-error-free rendering, wrong-password inline copy) all passed; screenshots visually confirmed brand tokens (Task 4) render correctly. Full detail in Dev Agent Record → Debug Log References.

- [x] **Task 13: Record deviations in `docs/decisions.md`** (housekeeping, matches Stories 1.2–1.7's pattern)
  - [x] One dated entry (newest-first, inserted at the top) covering: the `self_read_own_membership` RLS policy and why it was missing until now; the brand-token wiring into `globals.css` as the first real-UI story; the Overview-page scope decision (Open Question 2's resolution) and who/what owns filling in AD-02's stat cards/tables/alert panel later, since no current epic story explicitly claims that work; deletion of the starter tutorial scaffold.
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` — this story's migration is RLS-only (no table/column shape changes), so expect a byte-identical diff, same as Stories 1.5/1.7. Confirmed byte-identical.

### Review Findings

_Code review run 2026-07-10 — 3 parallel review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) against the working-tree diff, 15 patch findings, 1 deferred, 4 dismissed as noise/false-positive._

**Patch — all applied 2026-07-10**, verified via `pnpm typecheck` (clean except the same pre-existing, unrelated `ThemeProviderProps` error), `supabase test db` (121/121 assertions passing, including the 2 new same-user/two-gyms assertions), and a real headless-Chromium Playwright pass re-verifying at the literal 1024px/768px/375px breakpoints Task 12 specifies (10 targeted patch-verification checks + a full 38-check regression of the original AC #1/#2/#3 + responsive suite — all 48 passing, confirming no regressions and that the hamburger/breakpoint bug, the open-redirect, and the member-role rejection are all genuinely fixed, not just plausible-looking).

- [x] [Review][Patch] Open redirect via unsanitized `next`/`redirectTo` query param — `?next=//evil.com` passes `.startsWith("/")` and is a protocol-relative URL, sending a freshly-authenticated user off-site [apps/dashboard/components/login-form.tsx]
- [x] [Review][Patch] Hamburger toggle renders but is non-functional in the 768–1023px icon-rail range — `TopBar` uses `lg:hidden` (visible 0–1023px) while the Sidebar mobile overlay it's meant to open is `md:hidden` (visible only <768px); clicking the hamburger in the icon-rail range sets state with no visible effect [apps/dashboard/components/shared/TopBar.tsx, apps/dashboard/components/shared/Sidebar.tsx]
- [x] [Review][Patch] `app_role: "member"` (a real, non-staff `member_role` enum value) passes the `(dashboard)` layout guard, landing on Overview with a completely empty middle nav section — no redirect, no message [apps/dashboard/app/(dashboard)/layout.tsx, apps/dashboard/services/session.ts]
- [x] [Review][Patch] Duplicate claims fetch/validation — `layout.tsx` checks `claims.gym_id`/`claims.app_role` itself, then `getDashboardShellContext()` independently re-fetches claims and re-derives the same check, making its own "no gym context" branch effectively unreachable given its only caller [apps/dashboard/app/(dashboard)/layout.tsx]
- [x] [Review][Patch] Auth failures (no session) and backend failures (a genuine DB error fetching the gym/member row) both redirect to `/auth/login` identically — an authenticated user hitting a transient DB error gets silently bounced with no explanation, risking a redirect loop [apps/dashboard/app/(dashboard)/layout.tsx]
- [x] [Review][Patch] Spurious `console.error` logged for the ordinary "not logged in" case — `mapAndLog(claimsError)` is called even when `claimsError` is `null` and there's simply no session [apps/dashboard/services/session.ts]
- [x] [Review][Patch] `memberResult.error` is silently discarded — a genuine DB/RLS error on the `members` lookup is indistinguishable from "no row found," masked behind the email fallback with no trace [apps/dashboard/services/session.ts]
- [x] [Review][Patch] Logout `signOut()` has no error handling — on rejection, nothing is surfaced, the confirmation dialog never closes, and `confirming` state is never reset [apps/dashboard/components/shared/Sidebar.tsx]
- [x] [Review][Patch] Hardcoded `text-red-600` instead of the `--destructive` design token this same story wired into `globals.css` [apps/dashboard/components/login-form.tsx]
- [x] [Review][Patch] Mobile nav overlay has no `role="dialog"`/`aria-modal`, and no Escape-key dismissal, unlike every native `<dialog>` elsewhere in this codebase [apps/dashboard/components/shared/Sidebar.tsx]
- [x] [Review][Patch] `proxy.ts`'s `next` redirect param preserves only `pathname`, dropping the original query string — a deep link like `/members?filter=expiring` loses its filter after the post-login redirect [apps/dashboard/lib/supabase/proxy.ts]
- [x] [Review][Patch] `TopBar` never implements the "page-title slot" Task 8 literally specifies as one of its two jobs [apps/dashboard/components/shared/TopBar.tsx]
- [x] [Review][Patch] pgTAP test never actually covers the same-user/two-gyms scenario Task 11 explicitly demanded ("their own historical row at a different gym") — the fixture gives every user exactly one membership row, so the policy's documented lack of `gym_id` scoping is never proven by a test [supabase/tests/dashboard_shell_self_read_rls.test.sql]
- [x] [Review][Patch] Scope Boundary wording overclaims "route-level auth/role gating" — the actual guard is route-*group*-level (any valid staff role reaches any page under `(dashboard)`), not per-route minimum-role enforcement; harmless today (no differentiated-access route exists yet) but imprecise as written [story Dev Notes → Scope Boundary]
- [x] [Review][Patch] Dev Agent Record states Playwright verification used 1440/900/375px viewports, contradicting Task 12's literal instruction (1024px, 768px, 375px) — the imprecise breakpoint choice (900px instead of exactly testing the 768–1023px range's hamburger behavior) is why the icon-rail hamburger bug above went uncaught [story Dev Agent Record → Debug Log References]

- [x] [Review][Defer] Suspense fallback swaps to a second, disconnected `LoginForm` instance while `searchParams` resolves — theoretically loses typed input if the swap happens after the user starts typing [apps/dashboard/app/auth/login/page.tsx] — deferred, low practical likelihood (searchParams resolution involves no real I/O) and a proper fix (e.g. `use()` instead of a fallback swap) is disproportionate for a foundation-shell story

**Dismissed as noise/false-positive (4)**

- `self_read_own_membership`'s lack of a `gym_id` check, flagged by the context-free Blind Hunter as a "foot-gun" — this is a deliberate, already-documented design decision (migration comment + story Dev Notes both explain it explicitly; `services/session.ts` narrows by `gym_id` at the query level, matching the documented intent)
- `z.email()` flagged as "unverifiable/version-dependent Zod API usage" by the context-free Blind Hunter — confirmed correct: `packages/types` pins `zod: ^4.4.3`, and `z.email()` is already the established pattern in this exact codebase (`packages/types/src/schemas/gym.ts`'s `createGymSchema`)
- Inconsistent error-copy placement between client-side Zod validation and server error mapping — cosmetic, unspecified by AD-01's spec (which only defines placement for the three named server-driven error states), and the client-side path is barely reachable given native `required` attributes on both inputs
- Housekeeping note questioning whether the Task 10 dead-code deletions were "really" verified — they were (grep-confirmed during implementation, documented inline in Tasks 8/10's own patch notes)

## Dev Notes

### Scope Boundary (read first)

This story builds the **shell**: real login (AD-01), the role-filtered Sidebar, and route-*group*-level auth/role gating for the `(dashboard)` route group (any session with a valid gym-scoped staff role reaches any page under the group — there is no per-route minimum-role check yet, since `/` is the only real page that exists today; each future page adds its own role check as it's built, matching this project's "don't build gates for routes that don't exist" discipline), and a minimal Overview landing page. It does **not**:
- Build AD-02's live stat cards, "Currently Checked In" / "Expiring This Week" tables, or the Front-Desk Alert Panel. Those need `subscriptions`/`attendance_events`/`payments` RLS policies and real write paths that don't exist yet (Epics 2/3/4), and the Front-Desk Alert Panel specifically is FR-065, mapped only to Epic 4 in `epics.md`'s FR Coverage Map. Building fully-styled UI against tables with zero business RLS policies would either silently show permanent empty states (misleading — looks finished, isn't) or force this story to add those epics' RLS policies out of order, which is exactly the "don't add the next story's policy early" discipline Stories 1.3/1.4/1.7 already established.
- Build any of the other sidebar-linked pages (`/members`, `/subscriptions`, `/payments`, `/attendance`, `/audit`, `/settings`, `/coach`) — clicking those links 404s until their owning stories (Epic 2 onward, and 1.9 for Settings) ship. This is expected, matching this project's incremental-build precedent (e.g. Story 1.6 left an explicit "not built" marker in SA-03 for Story 1.7 to fill in).
- Add the "EN | FR" language toggle shown in the Sidebar mockup — no i18n library is wired in yet (Story 1.10's job).
- Touch `apps/super-admin` at all. It shares the same Supabase project/Auth instance but is a fully separate app with its own login/layout; nothing in this story's scope intersects it.

### `users.display_name` is dead data — do not use it

`log_audit_event()` (`0007_audit_log.sql`) treats `public.users.display_name` as the canonical actor-name source, which might suggest it's the right field for "logged-in user name" in the Sidebar. **It is never actually populated anywhere in this codebase** — confirmed by reading `apps/super-admin/app/(admin)/gyms/actions.ts`'s `createGym` flow end-to-end: `admin.auth.admin.createUser()` sets `email`/`phone` only, and the owner's name (`gym.ownerName`) is written exclusively to `members.name` via `insertOwnerMember`, never to `public.users.display_name`. Every real user in this system today has `display_name = null`, and `log_audit_event()`'s own fallback for that case is the literal string `"Unknown User"`. Use `members.name` (the current user's own row, gym-scoped) for the Sidebar's identity display instead — see Task 3.

### Open Questions for User/Architect Sign-Off

1. **Resolved 2026-07-10 — AD-01's mockup heading is `"Sign in to [Gym Name]"`, but the gym isn't known until *after* authentication.** No subdomain-per-gym or gym-picker mechanism exists anywhere in `architecture.md` or `prd.md`; `apps/dashboard` is one shared app at one URL for every gym's staff. Decision: pre-auth heading reads a static `"Sign in to GymOS"`; the real gym name only appears post-login, in the Sidebar (Task 8), which the architecture already supports via the existing `"read own gym"` RLS policy. Confirmed acceptable for V1 during story creation — revisit only if a future story introduces gym-specific invite/login links.
2. **Resolved 2026-07-10 — no epics.md story explicitly owns building AD-02's live stat cards / tables / Front-Desk Alert Panel** once their underlying data exists. FR-065 (the alert panel specifically) maps to Epic 4. The stat cards ("Checked in now," "Expiring this week," "Revenue this month") and the two tables have no FR/story mapping at all in the FR Coverage Map. Decision: this story ships a minimal placeholder only (Task 9) — no static full-layout build-ahead. This ownership gap is flagged for a future `correct-course` pass or explicit assignment to an Epic 3/4 story; confirmed acceptable to leave unowned for now during story creation.

### Technical Requirements & Architecture Compliance

- **RLS remains the sole tenancy/role enforcement layer.** `self_read_own_membership` is additive (ORs with existing policies for the same command) and cannot narrow any existing visibility — same discipline as every prior story's RLS additions.
- **Server Actions / service functions return `{ data, error }`, never throw for expected errors** — `getDashboardShellContext` follows the same contract as `services/gyms.ts`'s functions, even though login itself is a direct `supabase.auth.signInWithPassword()` client call (matching this codebase's existing, unmodified pattern — auth calls aren't "business logic operations" per architecture's own Server Actions boundary, so no new Server Action is needed for login itself).
- **snake_case at the DB boundary, camelCase in UI-local state** — `gymName`/`memberName`/`role` in the service/component layer map to `name`/`app_role` at the actual query/claims boundary.
- **`getClaims()` over `getUser()`** — established convention (`components/auth-button.tsx`, `(admin)/layout.tsx`, and Story 1.7's Review Findings which explicitly removed a `getUser()` call for this reason). Every claims read in this story uses `getClaims()`.
- **Destructive/sensitive-confirmation buttons name their target** (UX-DR12) — the Logout confirmation is a borderline case (not literally destructive, but UX explicitly specs a confirm step); `"Log out of GymOS?"` already names the target ("GymOS"), matching the pattern without needing a per-user name in the copy.
- **Validate on submit only** (UX-DR11) — the login form's `loginSchema` check, matching every other form in this codebase.

### Previous Story Intelligence

- **`apps/dashboard` has had zero feature work done on it before this story.** Stories 1.1–1.7 all touched `apps/super-admin` and `supabase/`. `apps/dashboard` is still the byte-for-byte `create-next-app -e with-supabase` scaffold (confirmed via diff-free comparison against `apps/super-admin`'s `package.json`, which is identical). This story is the first to build real functionality here — there is no established `services/`, `components/shared/`, or route-group pattern in *this* app to follow; follow `apps/super-admin`'s equivalent patterns instead (this Dev Notes section does that throughout).
- **The native `<dialog>` element is this codebase's only modal pattern** (`GymLifecycleDialog.tsx`, `EscalateAccessDialog.tsx`) — no `Dialog` primitive exists in either app's `components/ui/`. The Logout confirmation (Task 8) follows the same shape: `useRef<HTMLDialogElement>`, `useEffect` → `showModal()`, `onCancel` guard.
- **`mapAndLog` is a per-app local helper, not a shared export** — `apps/super-admin/services/gyms.ts` defines its own copy; `apps/dashboard/services/session.ts` needs its own too (Task 3). This is deliberate (architecture's service-layer boundary: "not shared across apps directly, since Next.js and Expo use `supabase-js` in different runtime contexts" — the same reasoning applies between the two Next.js apps too, per the established precedent of `tiers.ts`/`metrics.ts` importing `gyms.ts`'s copy *within* the same app, never across apps).
- **Story 1.7's Review Findings are directly relevant here**: it replaced an unguarded `supabase.auth.getUser()` call (which can rethrow a raw, non-`AuthError` exception in some SDK paths) with `getClaims()` (a local JWT decode, no throw-prone Auth-server round trip) specifically inside a `Promise.all`. `getDashboardShellContext` (Task 3) does two parallel Supabase queries — get claims *first*, synchronously, before starting the `Promise.all` for the gym/member row fetches, not inside it.
- **`supabase test db` finds real bugs on every prior story** (1.3–1.7) — actually run it.
- **Docker/Supabase CLI environment quirk** (Stories 1.4–1.7): may be unavailable from the primary Windows shell but already running under WSL2; the WSL2 VM idle-shuts-down within seconds of no active WSL process, tearing the Docker stack down mid-session. Hold a long-lived background process there during verification.
- **`packages/types/src/database.ts` regeneration**: expect byte-identical output (RLS-only migration) — same as Stories 1.5/1.7, unlike 1.6.

### Git Intelligence Summary

- HEAD is `223e66b` (feat(story-1.7): implement super admin escalated gym data access, close code review findings). Working tree is clean. Migrations 0001–0012 are landed; this story adds `0013_dashboard_shell_self_read.sql`.
- Established two-commit shape across every prior story: one `feat(story-1.8)` for initial implementation, one `fix(story-1.8)` after code review closes findings. Follow it.
- Every prior story's commit only touched `apps/super-admin` + `supabase/` + `packages/types` + `docs/decisions.md`. This is the first story with a commit diff centered on `apps/dashboard` — expect a larger file-count diff than 1.5–1.7 due to Task 10's deletions (10+ removed files) alongside the new ones.

### Testing Standards

- pgTAP, `supabase/tests/*.test.sql`, run via `supabase test db` — same CI job as Stories 1.3–1.7, no new CI wiring needed.
- Manual end-to-end verification (Task 12) is required, not optional — this project has no automated E2E dashboard testing in V1. This story additionally needs a **visual/responsive** check (Sidebar breakpoints), which pgTAP obviously can't cover and which Stories 1.5–1.7 didn't need (no responsive UI shipped before this story).

### Project Structure Notes

- `supabase/migrations/0013_dashboard_shell_self_read.sql` — next sequential number after `0012`.
- `apps/dashboard/app/(dashboard)/` is a new route group; `apps/dashboard/app/page.tsx` and `apps/dashboard/app/protected/` are deleted in the same story (Task 10) to avoid a route collision on `/` and to avoid leaving superseded tutorial code behind.
- `apps/dashboard/components/shared/` is new (architecture.md names it; this is the first story to populate it in this app — `apps/super-admin` has no equivalent `components/shared/` yet either, since its Sidebar-equivalent is the flat nav in `(admin)/layout.tsx`, not a separate component).
- `apps/dashboard/services/` is new — first service file in this app.
- `packages/types/src/schemas/auth.ts` is new — first schema file not named after a domain entity (`gym.ts`, `tier.ts`); `auth` is the right name since `loginSchema` isn't gym- or tier-shaped.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.8: Gym Owner Login & Role-Filtered Dashboard Shell] — story statement and all 3 ACs
- [Source: _bmad-output/planning-artifacts/epics.md#6.13 Gym Admin Dashboard, FR-064] — "Next.js gym admin dashboard with role-gated pages"
- [Source: _bmad-output/planning-artifacts/epics.md#FR Coverage Map] — FR-064 maps only to Epic 1 (this story); FR-065 (Front-Desk Alert Panel) maps only to Epic 4, confirming the Scope Boundary above
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Foundation] — dashboard auth is email+password; role-based rendering means inaccessible items are absent, not disabled
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Navigation Structure, Admin Dashboard — Sidebar] — full Sidebar spec: dimensions, content order, Role visibility matrix, active-state styling, Logout confirmation copy
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-01 · Login] — layout, interactions, exact error copy
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-02 · Overview] — full live-data spec (out of scope this story, see Scope Boundary)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Admin Dashboard — Responsive Breakpoints] — 1280/1024/768px breakpoint behavior, hamburger/icon-rail spec
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md] — three brand tokens (hex values) and their UI role
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure] — names `app/(dashboard)/layout.tsx`, `components/shared/Sidebar.tsx`, `services/` for `apps/dashboard`
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] — "Dashboard/Coach/Super Admin auth: Supabase Auth email + password... no alternative needed"
- [Source: supabase/migrations/0003_members_and_users.sql] — `members`/`users` schema; confirms `users` and `members` both have RLS enabled with no self-read policy prior to this story
- [Source: supabase/migrations/0009_auth_hook_gym_claims.sql] — `private.gym_id()`, `custom_access_token_hook`, the `gym_id`/`app_role` claim shape, and the existing `"read own gym"` policy this story reuses
- [Source: supabase/migrations/0004_subscriptions_and_plans.sql, 0005_payments.sql, 0006_attendance.sql] — confirms `subscriptions`/`payments`/`attendance_events` all have RLS enabled with zero business policies, supporting the Scope Boundary decision to not query them from Overview
- [Source: supabase/migrations/0007_audit_log.sql] — `log_audit_event()`'s `users.display_name` lookup and its "Unknown User" fallback, motivating the "dead data" note above
- [Source: apps/super-admin/app/(admin)/layout.tsx] — the exact claims-check + redirect pattern this story's `(dashboard)/layout.tsx` mirrors (inverted: excluding `super_admin` sessions instead of including them)
- [Source: apps/super-admin/app/(admin)/gyms/actions.ts] — confirms `users.display_name` is never written by `createGym`
- [Source: apps/super-admin/services/gyms.ts] — `mapAndLog` pattern, `{ data, error }` service shape to replicate in `apps/dashboard/services/session.ts`
- [Source: apps/super-admin/app/(admin)/gyms/components/GymLifecycleDialog.tsx, EscalateAccessDialog.tsx] — native `<dialog>` modal pattern for the Logout confirmation
- [Source: apps/dashboard/lib/supabase/proxy.ts, apps/super-admin/lib/supabase/proxy.ts] — identical starter middleware, including the `/` exemption bug this story fixes only in `apps/dashboard` (super-admin's `/` is a harmless unused marketing stub, not a real route)
- [Source: apps/dashboard/app/globals.css, tailwind.config.ts] — current shadcn generic CSS variables this story overwrites with `DESIGN.md`'s tokens
- [Source: apps/dashboard/components/ui/badge.tsx] — existing `Badge` component to reuse for the role pill
- [Source: packages/types/src/schemas/gym.ts, packages/types/src/errors.ts] — existing schema/error-mapping conventions `auth.ts` (Task 2) follows
- [Source: supabase/tests/gym_data_escalation_rls.test.sql] — pgTAP session-simulation conventions to replicate
- [Source: docs/decisions.md] — established dated-entry format (newest first)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- **`supabase test db` initially failed 3/6 of the new test file's assertions** immediately after writing `0013_dashboard_shell_self_read.sql` — same root cause Story 1.7 documented: the already-running local Postgres container had not picked up the new migration file. `supabase test db` alone does not apply new migrations to an already-running local stack. `supabase db reset` (drop + recreate + reapply all migrations 0001–0013) fixed it.
- **After the reset, two *pre-existing* pgTAP tests regressed** (`gyms_super_admin_rls.test.sql` test 21, `rls_tenant_isolation.test.sql` test 3) — both had asserted "an owner/member-claim session sees 0 `members` rows" as proof of the old deny-all coverage. `self_read_own_membership` makes that assertion obsolete by design (the session now correctly sees exactly its own row). Updated both tests to assert `count = 1` (and, for `gyms_super_admin_rls.test.sql`, that the visible row's `name` is the session's own row, not a different user's row seeded elsewhere in the same fixture) rather than silently declaring this "expected failure, ignore." `gyms_super_admin_rls.test.sql`'s `plan()` count was bumped from 22 to 23 for the added name-check assertion. Final suite: 119/119 assertions passing (112 baseline + 6 new + 1 added).
- **`packages/types/src/database.ts` regeneration confirmed byte-identical** via `diff` against `supabase gen types typescript --local` output (RLS-only migration, no schema shape change) — same as Stories 1.5/1.7.
- **WSL2 idle-shutdown quirk (Stories 1.4–1.7's documented issue) hit repeatedly this session** — `supabase test db`/`supabase gen types`/the local Postgres connection failed with `ECONNREFUSED`/`PgClient: Failed to connect` multiple times between tool calls, since each `wsl -e bash -lc "..."` invocation is a separate process and the WSL2 VM tears down within seconds of the last one exiting. Worked around by starting a long-lived background process (`supabase start; sleep 1200`) inside WSL2 before each verification pass, matching the story's own Dev Notes guidance.
- **`next build`/`next dev` type-check and `pnpm lint` both surface one pre-existing, unrelated failure each**: the `ThemeProviderProps`/`children` type error at `app/layout.tsx:30` (confirmed identical and pre-existing on the untouched `apps/super-admin/app/layout.tsx:30` too — Stories 1.5/1.6 already documented this as predating any of their branches), and an ESLint config resolution error (`Cannot find module 'next/dist/compiled/babel/eslint-parser'`) confirmed identical on the untouched `apps/super-admin` app as well — a broken/missing dependency in the monorepo's `node_modules`, not something this story's changes caused. Neither blocks `next build`'s "Compiled successfully" phase, which did pass cleanly for every route this story added or touched.
- **A real bug was caught only by browser-driven verification, not by `next build` or typecheck**: the initial `app/auth/login/page.tsx` awaited `searchParams` directly in the top-level page component. Next.js 16.2.10's Cache Components mode allows this to compile and run, but logs a runtime console error ("Runtime data such as `cookies()`, `headers()`, `params`, or `searchParams` was accessed outside of `<Suspense>`... This delays the entire page from rendering") and forces the whole route dynamic. Caught via a headless-Chromium (Playwright) session's `console --errors`-equivalent check during manual E2E verification (Task 12) — `next build`'s type-check phase does not catch this class of issue. Fixed by moving the `searchParams` read into a small async component wrapped in `<Suspense>`, mirroring `apps/super-admin/app/(admin)/gyms/[id]/page.tsx`'s existing outer-sync/inner-async pattern. Re-verified clean (0 console errors across all 3 roles) after the fix.
- **Manual E2E verification used two complementary temporary scripts** (both deleted before completion, never committed, matching Stories 1.5–1.7's `_verify_1_X.mjs` precedent): (1) a Node script using the GoTrue Admin API + `supabase-js` to create real `owner`/`receptionist`/`coach` test accounts, sign in for real, decode the resulting JWTs to confirm `app_role`/`gym_id` claims, and confirm `self_read_own_membership`'s row-level behavior directly against the DB — 19/19 checks passed; (2) since `chromium-cli` (the `run` skill's default browser-automation tool) was not available in this Windows/WSL2 environment, Playwright + a headless Chromium build were installed on demand into an isolated scratchpad directory, and used to drive a real `next dev` server end-to-end for all 3 roles: login, DOM-level nav-item presence/absence (not just visual), viewport breakpoint checks at **1440/900/375px, console-error-free rendering, and the wrong-password inline-error copy — 38/38 checks passed**, with screenshots confirming the brand tokens (Task 4) and Sidebar/TopBar layout render correctly. All test fixtures (gym, tier, members, auth users) created by both scripts were cleaned up afterward. **Correction (code review, same day)**: 900px is within the 768–1023px icon-rail range but is not the literal `768px` Task 12 specifies, and the check only asserted the rail was visible — it never asserted the hamburger was *absent* there. That gap is exactly why the review's icon-rail hamburger bug (Review Findings, patch #2) went uncaught by this pass. The review-patch re-verification below tests the literal 1024px/768px/375px breakpoints and explicitly asserts hamburger visibility at each.

- **Code review (same day) found and fixed 15 real issues** across 3 parallel review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) — full list in Review Findings above. Two are worth calling out here: an **open redirect** (`?next=//evil.com` bypassed the same-origin check via a protocol-relative URL) and the **icon-rail hamburger bug** described above, both confirmed independently by more than one review layer. Re-verification after patching used a fresh headless-Chromium Playwright pass: 10 targeted checks at the literal 1024px/768px/375px breakpoints (confirming the hamburger is genuinely absent at 1024 and 768, present and functional at 375, the mobile overlay has `role="dialog"`/`aria-modal`/Escape-key dismissal, the open redirect no longer navigates off-site, a `member`-role login is now rejected rather than landing on an empty Sidebar, and normal logout still works after the error-handling patch) plus a full 38-check re-run of the original AC #1/#2/#3 + responsive suite to confirm zero regressions — 48/48 passing. `supabase test db` re-run at 121/121 (added 2 assertions for the same-user/two-gyms scenario, Review Findings patch #13). One pgTAP regression was found and fixed *during* this re-verification pass itself: leftover fixture data from the story's own first (pre-Suspense-fix) Playwright round had never been cleaned up (only the second round's fixtures were), polluting row-count assertions in two unrelated, already-passing test files (`gyms_super_admin_rls.test.sql`, `tiers_and_gym_lifecycle_rls.test.sql`) — not a code defect, a verification-hygiene gap; the orphaned gym/tier/members/auth-users rows were identified and removed directly, and the suite passed clean afterward.

### Completion Notes List

- All 13 tasks implemented: migration `0013_dashboard_shell_self_read.sql` (`self_read_own_membership` RLS policy on `members`); `packages/types` gained `loginSchema`; `apps/dashboard/services/session.ts` (`getDashboardShellContext`, first service file in this app); `DESIGN.md`'s three brand tokens wired into `globals.css` (first real-branded UI in this app); AD-01 login fully rebuilt (`login-form.tsx`, `auth/login/page.tsx`, `lib/supabase/proxy.ts`'s `next` redirect param and `/` exemption fix); `app/(dashboard)/layout.tsx` (claims/role guard, mirrors `apps/super-admin`'s `(admin)/layout.tsx`); `components/shared/Sidebar.tsx` + `TopBar.tsx` + `DashboardChrome.tsx` (role-filtered nav, responsive icon-rail/hamburger-overlay, Logout confirmation dialog); `app/(dashboard)/page.tsx` (minimal Overview placeholder, deliberately not the full AD-02 mockup); starter/tutorial scaffold removed (`app/page.tsx`, `app/protected/`, and 9 now-orphaned components); 6 new pgTAP assertions + 1 added assertion to an existing test (119 total, all passing); full manual E2E verification via both a real-GoTrue-login Node script and a real headless-Chromium Playwright session; `docs/decisions.md` 5-decision entry recorded; `packages/types/src/database.ts` regenerated and confirmed byte-identical.
- Both Open Questions from Dev Notes were resolved during story creation and implemented as specified: (1) AD-01's login heading is a static `"Sign in to GymOS"`, not the mockup's literal `"Sign in to [Gym Name]"`; (2) AD-02 Overview ships as a minimal placeholder, not the full stat-card/table/alert-panel layout.
- **Two implementation details beyond the story's literal task text, both disclosed in the relevant task's patch note above**: (1) `components/shared/DashboardChrome.tsx` — a small client component not separately named in Task 7/8, needed to share mobile-nav-open state between `Sidebar` and `TopBar` without prop-drilling through the Server Component layout; (2) `components/shared/TopBar.tsx`'s hamburger button is intentionally the *only* thing it renders — gym name/user name/role pill live in the Sidebar per the more detailed Navigation Structure spec, not duplicated in a second identity display.
- **One deviation from the story's literal Task 5 text**: the `searchParams`-in-`<Suspense>` restructuring of `auth/login/page.tsx` wasn't anticipated in the story (written before this Next.js 16 Cache Components behavior was hit in practice) — added during implementation once a real console error surfaced it, following the codebase's own established pattern for the same class of issue rather than inventing a new one.
- Local dev/testing environment (`apps/dashboard/.env.local`) remained pointed at local Supabase per Stories 1.2–1.7's established precedent; not part of the tracked File List (gitignored).
- `apps/dashboard/app/auth/sign-up/`, `sign-up-success/`, and `components/sign-up-form.tsx` were deliberately left untouched (out of scope per the story's own Task 5 note) — no longer linked from the login form (the "Sign up" link was removed), but the route/component files themselves remain as harmless dead code pending a future cleanup pass.

### File List

**New:**
- `supabase/migrations/0013_dashboard_shell_self_read.sql`
- `supabase/tests/dashboard_shell_self_read_rls.test.sql`
- `packages/types/src/schemas/auth.ts`
- `apps/dashboard/services/session.ts`
- `apps/dashboard/app/(dashboard)/layout.tsx`
- `apps/dashboard/app/(dashboard)/page.tsx`
- `apps/dashboard/components/shared/Sidebar.tsx`
- `apps/dashboard/components/shared/TopBar.tsx`
- `apps/dashboard/components/shared/DashboardChrome.tsx`

**Modified:**
- `packages/types/src/index.ts` (added `export * from "./schemas/auth"`)
- `apps/dashboard/components/login-form.tsx` (full rewrite to match AD-01)
- `apps/dashboard/app/auth/login/page.tsx` (Suspense-wrapped `searchParams` → `next` redirect param)
- `apps/dashboard/lib/supabase/proxy.ts` (removed `/` exemption; appends `?next=` on redirect)
- `apps/dashboard/app/globals.css` (GymOS brand tokens: `--background`, `--primary`, `--accent`)
- `apps/dashboard/app/layout.tsx` (metadata title/description)
- `supabase/tests/gyms_super_admin_rls.test.sql` (updated `members` assertion for the new self-read policy, `plan()` 22→23)
- `supabase/tests/rls_tenant_isolation.test.sql` (updated `members` assertion for the new self-read policy)
- `docs/decisions.md` (added 2026-07-10 Story 1.8 entry, 5 decisions)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status tracking)
- `_bmad-output/implementation-artifacts/deferred-work.md` (added Story 1.8 deferred item)

**Modified (review-patch pass):**
- `apps/dashboard/components/login-form.tsx` (open-redirect fix, `text-destructive` token)
- `apps/dashboard/components/shared/TopBar.tsx` (breakpoint fix `lg:hidden`→`md:hidden` on the hamburger, added optional `title` slot)
- `apps/dashboard/components/shared/Sidebar.tsx` (Escape-key + `role="dialog"`/`aria-modal` on the mobile overlay, logout error handling)
- `apps/dashboard/components/shared/DashboardChrome.tsx` (threads optional `title` prop to `TopBar`)
- `apps/dashboard/app/(dashboard)/layout.tsx` (removed duplicate claims check, distinguishes backend errors from no-session)
- `apps/dashboard/services/session.ts` (added `STAFF_ROLES` check, fixed spurious error logging, logs but doesn't swallow `memberResult.error`)
- `apps/dashboard/lib/supabase/proxy.ts` (preserves query string in the `next` redirect param)
- `supabase/tests/dashboard_shell_self_read_rls.test.sql` (added same-user/two-gyms test case, `plan()` 6→8)
- `_bmad-output/implementation-artifacts/1-8-gym-owner-login-role-filtered-dashboard-shell.md` (Scope Boundary wording fix, Review Findings section, corrected viewport claim)

**Deleted (superseded starter/tutorial scaffold):**
- `apps/dashboard/app/page.tsx`
- `apps/dashboard/app/protected/layout.tsx`
- `apps/dashboard/app/protected/page.tsx`
- `apps/dashboard/components/hero.tsx`
- `apps/dashboard/components/deploy-button.tsx`
- `apps/dashboard/components/next-logo.tsx`
- `apps/dashboard/components/supabase-logo.tsx`
- `apps/dashboard/components/theme-switcher.tsx`
- `apps/dashboard/components/env-var-warning.tsx`
- `apps/dashboard/components/auth-button.tsx`
- `apps/dashboard/components/logout-button.tsx`
- `apps/dashboard/components/tutorial/code-block.tsx`
- `apps/dashboard/components/tutorial/connect-supabase-steps.tsx`
- `apps/dashboard/components/tutorial/fetch-data-steps.tsx`
- `apps/dashboard/components/tutorial/sign-up-user-steps.tsx`
- `apps/dashboard/components/tutorial/tutorial-step.tsx`

Not tracked (gitignored, local-dev-only): `apps/dashboard/.env.local`. Not tracked (temporary, deleted before completion, never committed): `apps/dashboard/_verify_1_8.mjs`, `apps/dashboard/_verify_1_8_setup.mjs`, `apps/dashboard/_verify_1_8_cleanup.mjs`, `apps/dashboard/_verify_1_8_patches.mjs`, `apps/dashboard/_verify_1_8_regression.mjs`, `apps/dashboard/_cleanup_all.mjs`.

## Change Log

- 2026-07-10: Code review (3 parallel review layers, 15 patch findings, 1 deferred, 4 dismissed) — all 15 patches applied. Notable fixes: an open redirect via the unsanitized `next`/`redirectTo` query param (`?next=//evil.com` bypassed the same-origin check); the mobile-nav hamburger was visible but non-functional in the 768–1023px icon-rail range (breakpoint mismatch between `TopBar`'s `lg:hidden` and the overlay's `md:hidden` — now both `md:hidden`); a non-staff `app_role: "member"` session previously passed the dashboard guard and landed on an empty Sidebar with no explanation (now rejected via a new `STAFF_ROLES` check, folded into a broader refactor that also removed a duplicate claims-validation pass between `layout.tsx` and `session.ts`, stopped conflating auth failures with genuine backend errors, and stopped a spurious `console.error` on the ordinary logged-out case); `memberResult.error` was silently swallowed; the Logout confirmation had no error handling; the mobile overlay had no `role="dialog"`/`aria-modal`/Escape-key dismissal; a hardcoded `text-red-600` bypassed the `--destructive` token this story itself wired in; `proxy.ts`'s `next` redirect dropped the original query string; `TopBar` was missing the "page-title slot" Task 8 literally specified; the pgTAP suite never actually tested the same-user/two-gyms scenario Task 11 explicitly demanded (added, `plan()` 6→8, 121/121 total); the Scope Boundary's "route-level" gating wording was corrected to "route-*group*-level"; and the Dev Agent Record's stated verification viewports (1440/900/375px) were corrected to reflect literal re-verification at 1024px/768px/375px, which is what caught the icon-rail bug in the first place. Also found and fixed a verification-hygiene gap (not a code defect) during re-verification: orphaned fixture data from an earlier, incompletely-cleaned-up Playwright round was polluting row-count assertions in two unrelated pgTAP files — removed, suite passes clean. Re-verified via `pnpm typecheck` (clean, same pre-existing unrelated error), `supabase test db` (121/121), and a real headless-Chromium Playwright pass (48/48: 10 targeted patch checks at the literal Task-12 breakpoints + a full 38-check regression of AC #1/#2/#3, zero regressions). Status set to `done`.
- 2026-07-10: Implemented Gym Owner Login & Role-Filtered Dashboard Shell end-to-end — migration `0013_dashboard_shell_self_read.sql` (`self_read_own_membership` RLS policy, the first policy letting a gym-scoped session read even its own `members` row); real AD-01 login (branded, exact AD-01 error copy, show/hide password, redirect-back-to-deep-link); `app/(dashboard)/layout.tsx`'s claims/role guard; role-filtered `Sidebar`/`TopBar`/`DashboardChrome` (240px desktop, 64px icon rail, hamburger overlay <768px, Logout confirmation); GymOS brand tokens wired into `globals.css`; minimal AD-02 Overview placeholder (full build deferred, no epic currently owns it); starter/tutorial scaffold removed. Found and fixed two real issues during verification: two pre-existing pgTAP tests asserted the old deny-all `members` behavior the new self-read policy intentionally changes (updated, not silenced); a Next.js 16 Cache Components Suspense violation on `searchParams` in the login page, caught only via real browser console inspection during manual E2E verification (not by `next build`'s type-check). Manual E2E verification went beyond the story's literal ask: alongside a DB/GoTrue-level Node script (19 checks), a real headless-Chromium Playwright session drove the actual `next dev` server for all 3 roles (38 checks: DOM-level nav presence/absence, responsive breakpoints, console-error-free rendering, wrong-password inline copy), since `chromium-cli` wasn't available in this environment. `supabase test db`: 119/119 assertions passing. `pnpm typecheck`/`next build`: clean except two confirmed pre-existing, unrelated failures (`ThemeProviderProps` type error, broken `eslint-config-next` dependency resolution) also present on the untouched `apps/super-admin` app. `packages/types/src/database.ts` regenerated and confirmed byte-identical. 5-decision entry recorded in `docs/decisions.md`. Status set to `review`.
