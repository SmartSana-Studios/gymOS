---
baseline_commit: d770f6798a381b1f94b8504cd1eae559354a7e79
---

# Story 1.14: Super Admin — Escalated Member & Payment Data View

Status: review

> **Depends on Story 1.15 (Escalation Grant Expiry & Revocation) — implement 1.15 first.**
> 1.15 changes what "escalated" means (24-hour TTL + revocation) and replaces the `escalated`
> derivation this story reads. Building 1.14 first ships a derivation 1.15 immediately
> invalidates, and would render "Access granted" for lapsed grants while RLS correctly
> returned nothing — a confusing failure that looks like a data bug. See Dev Notes →
> Dependency on Story 1.15.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As GymOS platform staff who has already escalated into a specific gym,
I want to actually read that gym's member and payment records on the Gym Detail page,
so that the escalation I performed produces the support visibility it promises instead of unlocking data nothing can display.

**Context — not derived from `epics.md`.** This story does not exist in `_bmad-output/planning-artifacts/epics.md`, and neither does any FR describing it. It was raised directly by the user (2026-09-06) after observing that SA-03's post-escalation indicator reads "Access granted — you can view this gym's member and payment records" while the Super Admin app has no surface that displays either. This is the same class of user-raised, proposal-less story as **1.12** (Super Admin Provisioning CLI) and **1.13** (Evolution API instance config) — both shipped without an `epics.md` entry. See Dev Notes → Origin & Authority for what governs the ACs in the absence of an FR.

Story 1.7 built the gate and said so explicitly in its own Scope Boundary: it does *not* "build any member-list or payment-list browsing UI for the Super Admin app... The RLS policies this story adds make that data *reachable* once escalated, for whichever future feature needs it (there is currently none planned)" [Source: `1-7-super-admin-escalated-gym-data-access.md:75-77`]. **This story is that future feature.** It adds no new authorization — every policy it relies on shipped in `0012_super_admin_data_access_escalation.sql`.

## Acceptance Criteria

1. **Given** I am a Super Admin viewing a Gym Detail page for a gym I have **not** escalated into, **When** the page renders, **Then** no member rows other than the already-visible owner summary and no payment rows appear anywhere on the page, **And** the server sends no such rows to the browser at all (verifiable in the rendered HTML / RSC payload, not merely hidden by CSS or a client-side conditional).
2. **Given** I have escalated into a gym, **When** I view its Gym Detail page, **Then** a read-only **Member records** section lists that gym's members at every role (not just `owner`), paginated at 25 rows/page, newest-joined first.
3. **Given** I have escalated into a gym, **When** I view its Gym Detail page, **Then** a read-only **Payment records** section lists that gym's payments, paginated at 50 rows/page, newest first.
4. **Given** either section is rendered, **When** I interact with it, **Then** it is read-only in the AD-12 sense: no edit/delete/flag/verify control, no row-selection checkbox, no row-click navigation, and no hover state implying editability.
5. **Given** a gym with no members beyond the owner, or no payments, **When** I view its escalated sections, **Then** each renders its own specified empty-state copy rather than an empty table shell.
6. **Given** the page is rendered in French, **When** either section displays, **Then** every string is translated — `check:i18n` passes with EN/FR key parity.
7. **Given** this story is complete, **When** the diff is reviewed, **Then** it contains **no new migration and no new RLS policy** — the reads go through `0012`'s existing `super_admin_escalated_read_members` / `super_admin_escalated_read_payments` policies and the RLS-bound request client, never `createAdminClient()`.

## Tasks / Subtasks

- [x] **Task 1: `services/gyms.ts` — two paginated read functions** (AC: #2, #3, #7)
  - [x] `listGymMembers(gymId, { page })` returning `{ data: GymMemberPage | null; error: AppError | null }`. Mirror `listGyms`'s exact pagination shape — `{ rows, total, page, pageSize }` (`services/gyms.ts:60-65`), computed with `const from = (page - 1) * PAGE_SIZE; const to = from + PAGE_SIZE - 1;` and `.select(..., { count: "exact" }).range(from, to)` (`:74-143`). `GYM_MEMBER_LIST_PAGE_SIZE = 25` (AD-03's stated page size, `EXPERIENCE.md:1100`).
  - [x] Guard the id with `gymIdSchema.safeParse(gymId)` first, returning `{ data: null, error: null }` on failure — the same "bad id is not-found, not an error" contract `getGymDetail` (`:181-183`) and `listGymAuditTrail` use.
  - [x] Order `join_date desc, id desc` (the `id` tiebreak is required: `join_date` is a `date`, not a timestamp, so same-day joins would otherwise page non-deterministically and silently drop/duplicate rows across pages).
  - [x] Select **only** these columns: `id, name, phone, role, join_date, deactivated_at`. Do **not** select `email`, `dob`, `photo_url`, `emergency_contact`, `goal`, `experience_level`, `height_cm`, `starting_weight_kg`, or `user_id` — all exist on the table and all are readable once escalated, which is exactly why the restriction has to be explicit here. FR-072 authorizes support escalation, not a full profile export; see Dev Notes → Data Minimization.
  - [x] `listGymPayments(gymId, { page })`, same shape, `GYM_PAYMENT_LIST_PAGE_SIZE = 50` (AD-09's stated page size, `EXPERIENCE.md:1314`). Order `created_at desc, id desc`.
  - [x] Select `id, amount, currency, method, status, created_at, reason` plus the member's name via a nested `members ( name )` embed — the FK `payments.member_id → members.id` makes this one round trip, and `members` is readable under the same escalation. Map to `memberName: string | null` in the returned row.
  - [x] Do **not** add an "Actor" column or select `actor_id`. Resolving an actor uuid to a display name needs a `public.users` read, and **no Super Admin SELECT policy exists on `public.users`** — the query would silently return nulls. AD-09's own Actor column is a gym-admin-side feature backed by different policies; it is deliberately absent here.
  - [x] Both functions use the RLS-bound `createClient()` from `@/lib/supabase/server`. **Never `createAdminClient()`** — see Dev Notes → Critical Guardrails.
  - [x] Map snake_case → camelCase by hand in the service layer, matching `listGymAuditTrail` (`:270-277`); do not leak raw DB row shapes into components.

- [x] **Task 2: `gyms/[id]/page.tsx` — conditional server-side fetch** (AC: #1, #2, #3)
  - [x] **After Story 1.15, `escalated` comes from `getActiveEscalationForCurrentActor(gymId)`** (1.15 Task 4), which accounts for the 24-hour TTL and revocation. Reuse whatever that story left in `page.tsx`; do not add a second escalation query, and do not resurrect `isGymDataAccessEscalated()` — it was deliberately deleted (Dev Notes → Previous Story Intelligence). If you find `page.tsx` still deriving `escalated` from the audit trail (`page.tsx:53-62`, the pre-1.15 shape), stop: 1.15 has not landed and this story is out of order.
  - [x] The two new fetches must be **conditional on `escalated`**, issued only after it resolves, and must not join the existing `Promise.all` (which runs before `escalated` is known). When `escalated` is false, pass `members={null}` / `payments={null}` to the client component. This is AC #1's "the server sends no such rows" requirement — RLS would already return zero rows for a non-escalated actor, so this is deliberate defence in depth, not the primary control. State that in a code comment so a later reader does not "simplify" it away.
  - [x] Read the two page numbers from `searchParams` as `mpage` / `ppage` (two independent tables on one route need two independent page params; a shared `page` would move both at once). `gyms/[id]/page.tsx` currently takes only `params`. Add `searchParams: Promise<{ mpage?: string; ppage?: string }>` to the **outer** `GymDetailPage` and forward it unawaited into `GymDetailData`, where it is awaited alongside `params` — exactly the shape `gyms/page.tsx:21-35` already uses. Awaiting it in the outer component would pull dynamic data outside the `<Suspense>` boundary and trip `cacheComponents`.
  - [x] Add the two new error results to the existing `if (gymError || tiersError || auditTrailError)` branch (`page.tsx:44-47`) so a failed member/payment read renders `t("common.loadError")` rather than a half-page.

- [x] **Task 3: Two new read-only components** (AC: #2, #3, #4, #5)
  - [x] `gyms/[id]/components/GymMembersTable.tsx` and `gyms/[id]/components/GymPaymentsTable.tsx`, both client components.
  - [x] Mount them in `GymDetailPageClient.tsx` directly below `<AuditTrailTab entries={auditTrail} />` (`GymDetailPageClient.tsx:140`), each rendering `null` when its prop is `null` (not escalated). Follow `AuditTrailTab`'s container exactly — an always-visible bordered section (`<div className="space-y-3 rounded-md border p-6">` with an `<h2 className="text-sm font-semibold text-muted-foreground">` heading), **not** a tab-switcher. There is still no Tabs primitive in `apps/super-admin/components/ui/` (confirmed current: only `badge, button, card, checkbox, dropdown-menu, input, label`). Do not add one.
  - [x] Table markup copies `GymsPageClient.tsx:193-291`: `<div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead className="border-b bg-muted/50 text-left">`, `<th className="p-3 font-medium">`, `<td className="p-3">`. Add `scope="col"` on every `<th>` (UX-DR12's `<table>` semantics requirement, `epics.md:291`) — note `GymsPageClient` omits it, so copy its classes but not that gap.
  - [x] **Read-only enforcement (AC #4), per AD-12's explicit rule block (`EXPERIENCE.md:1478-1483`):** drop `GymsPageClient`'s `cursor-pointer` + `onClick` row handler and its `hover:bg-muted/30`. Rows carry no action cell, no checkbox, no context menu. Only `border-b last:border-0` remains.
  - [x] Member columns: Name, Phone, Role, Joined, Status. "Status" here is `deactivated_at === null ? active : deactivated` only — it is **not** UX-DR5's 5-state subscription badge, because `subscriptions` is unreadable (Dev Notes → Scope Boundary). Label the column so it cannot be mistaken for subscription status.
  - [x] Payment columns: Member, Amount, Method, Status, Date, Reason.
  - [x] Pagination: reuse `GymsPageClient.tsx:293-324`'s numbered pager verbatim in shape, but push `mpage`/`ppage` respectively via `useSearchParams`/`router.push` while **preserving the other table's param** (build from `new URLSearchParams(searchParams.toString())` as `updateParams` already does, `:66-83`). A gym with thousands of payments will render one button per page — cap the numbered buttons (e.g. a windowed range around the current page) rather than shipping `GymsPageClient`'s untruncated `Array.from({ length: totalPages })`, which is only safe at gym-list scale.
  - [x] Formatting: define local `formatAmount`/`formatDate` helpers inside each component following `apps/dashboard/.../PaymentsPageClient.tsx:79-99` — **always pass `i18n.language` explicitly** to `toLocaleString`. A bare `toLocaleString()` silently falls back to the server's locale (that file's own comment, `:93-96`). Do not copy `AuditTrailTab.tsx:50`'s bare call; it is a known pre-existing inconsistency. Render money as `{amount.toLocaleString(i18n.language)} {currency}` — there is no `Intl.NumberFormat` currency helper anywhere in this codebase and no XAF formatting precedent to introduce here.
  - [x] Empty states (AC #5), each its own key, matching UX-DR10's "every listed empty state uses its specified copy": members → "No member records for this gym." / payments → "No payment records for this gym." No CTA button — every action on this page is out of a Super Admin's read-only remit.

- [x] **Task 4: i18n** (AC: #6)
  - [x] New keys under `gyms.memberRecords.*` and `gyms.paymentRecords.*` in `apps/super-admin/locales/en.json` **and** `fr.json` — sibling namespaces to the existing `gyms.auditTrail.*`, matching its nesting depth (`en.json:75-108`).
  - [x] Do **not** reuse `gyms.table.*` (SA-02's gym-list headers) even where a word matches — `deferred-work.md:493` already logs cross-surface key reuse on this exact page as a live problem; do not add to it.
  - [x] Include a `role.*` sub-map for the six `member_role` enum values (`member, coach, receptionist, manager, owner, supervisor`) and a `status.*` sub-map for `payment_status`. Render `t()` lookups with the raw enum value as fallback, exactly as `AuditTrailTab.tsx`'s `ACTION_LABEL_KEY` does (`const label = labelKey ? t(labelKey) : entry.actionType`), so a future enum value renders raw rather than blank.
  - [x] Run `node scripts/check-i18n-key-parity.mjs` — it is a CI gate (UX-DR14, `epics.md:293`).

- [x] **Task 5: Loading skeleton** (AC: #2, #3)
  - [x] Extend `gyms/[id]/loading.tsx` with two more skeleton blocks. Row counts follow `EXPERIENCE.md:2146-2167`'s precedent table: 8 rows for the members table, 6 for payments. Keep it a plain presentational component with no logic, matching the existing file and `gyms/loading.tsx:4-15`.

- [x] **Task 6: pgTAP — confirm, do not re-prove** (AC: #7)
  - [x] `supabase/tests/gym_data_escalation_rls.test.sql` already proves the policies at `plan(9)`. This story adds **no** new policy, so add **no** new assertions there and do not renumber its plan.
  - [x] Run the full suite (`supabase test db`) as a regression gate only. Note the last live-verified count recorded in `docs/decisions.md` is 1622/1622 across 75 files; the tree now statically declares 1760 across 85. Report the real number you observe — do not copy either figure forward as if verified.

- [x] **Task 7: Manual end-to-end verification** (AC: #1-6 -- this project's standard for app-layer logic pgTAP cannot exercise)
  - [x] Provision a Super Admin (`pnpm --filter @gymos/super-admin provision-super-admin -- --email=...`) and seed a gym with several members at mixed roles plus several payments. **(admin-a/admin-b already provisioned from Story 1.15's manual pass, reused here. Iron Peak Fitness seeded to 29 members across all 5 non-owner roles -- member/coach/receptionist/manager/supervisor, 3 deactivated -- and 5 payments across pending/processing/verified/flagged with varied methods and reason text. A second gym, Quiet Peak Gym -- 1 owner-only member, 0 payments -- was also seeded for the AC #5 empty-state case.)**
  - [x] **Before escalating:** load the Gym Detail page and confirm via `view-source` / the RSC payload that no member or payment row is present in what the server sent (AC #1) — not just that nothing is visible.
  - [x] Escalate, then confirm both sections render, paginate independently (`mpage` and `ppage` move separately), and show correct data. **(Confirmed by smartsana 2026-09-06: escalated as admin-a, both Member records and Payment records rendered with correct mixed-role/status data. Clicked to page 2 of Member records -- different members shown, Payment records unaffected. Also confirmed AC #5's empty-state distinction on a second gym, Quiet Peak Gym: Payment records showed "No payment records for this gym." while Member records correctly showed one row -- the owner -- rather than empty-state copy, since a table with one real row is not the same state as a genuinely empty one.)**
  - [x] Confirm a **second** Super Admin account that has not escalated into that gym still sees neither section. **(Confirmed by smartsana 2026-09-06: logged in as admin-b, who holds no grant on Iron Peak Fitness -- neither Member records nor Payment records rendered, despite admin-b also being a Super Admin. Escalation is genuinely per-actor, not "any Super Admin sees everything.")**
  - [x] Re-check in French. **(Confirmed by smartsana 2026-09-06: section titles, column headers, and role/status labels all rendered in French with no English strings visible.)**
  - [x] **Check a suspended gym too.** `0073_tenant_suspension_enforcement.sql` added a RESTRICTIVE `tenant_active_gate` to both tables; its `or private.is_super_admin()` clause is what keeps escalated reads working when `gyms.status <> 'active'`. This is the single most likely silent regression surface in the story — verify it rather than assuming. **(Confirmed by smartsana 2026-09-06: Iron Peak Fitness suspended via a real super_admin session while admin-a's escalation grant was still live; reloading the page showed both sections completely unaffected -- all 29 members and all 5 payments still rendered. Gym restored to active afterward.)**

- [x] **Task 8: `docs/decisions.md`** (housekeeping, matches every prior Epic 1 story)
  - [x] One dated entry, newest-first at the top: the members+payments-only scope and the four tables deliberately left out; the column allow-list and its FR-072 reasoning; the no-per-view-audit-entry decision (Open Question 1) and its interaction with 1.7's permanent grant; that this story closes 1.7's deliberately-deferred consumer.

## Dev Notes

### Origin & Authority (read first)

There is **no FR for this view**. FR-071's V1 Super Admin capability table (`prd.md:525-534`) lists gym list, gym creation, gym management, platform metrics, tier management, tier assignment, and messaging instance management — and has no member/payment-browsing row. The authority for this story is FR-072's own wording, which presumes the access it gates is usable:

> **FR-072** — Super Admin access to individual member data or payment records within a specific gym requires an explicit support escalation action (not a standard view). Such access is audit-logged with the Super Admin's identity, reason, and timestamp. [Source: `prds/prd-gym_os-2026-06-20/prd.md:537`]

Read FR-072 as the binding constraint on *how* access happens (escalation-gated, audit-logged, per-gym), and this story as supplying the "not a standard view" view. Where FR-072 is silent — which columns, which adjacent tables, whether each view re-logs — the ACs above make the call and Dev Notes records why. Do not infer additional scope from FR-071's absence of a row; do not exceed the ACs on the strength of FR-072's generality.

### Scope Boundary — what escalation actually unlocks

`0012_super_admin_data_access_escalation.sql` grants exactly **three** SELECT policies: `super_admin_read_audit_log` (platform-wide, unfiltered), `super_admin_escalated_read_members`, and `super_admin_escalated_read_payments`. **That is the entire surface.** Every other gym-scoped table has **no** Super Admin read policy of any kind:

| Table | Super Admin read? | Consequence for this story |
|---|---|---|
| `subscriptions` | **No** | Cannot show plan name, expiry date, or UX-DR5's 5-state status badge. This is why AC #2's member table has no Plan/Expiry column despite AD-03 having both. |
| `attendance_events` | **No** | No "Last check-in" column (AD-03 has one). |
| `refunds` | **No** | Payment rows cannot show refund state. |
| `coach_assignments`, `session_notes`, `progress_entries`, `progress_photos`, `member_preferences`, `class_bookings` | **No** | All out of scope. |
| `public.users` | **No** | No actor display-name resolution — hence no Actor column (Task 1). |

`0073`'s RESTRICTIVE `tenant_active_gate` on these tables carries `or private.is_super_admin()`, but a restrictive policy only narrows an existing permissive grant — it never creates one. **Do not read `is_super_admin()` appearing in a policy as evidence the table is readable.**

If a reviewer or the user wants plan/expiry in this view, that is a **new migration adding an escalation-gated policy on `subscriptions` in the exact `EXISTS (... action_type = 'gym_data_escalation' ...)` shape as `0012`** — a deliberate, separately-sized change, not something to slip into this story. This story ships with zero migrations (AC #7).

### Critical Guardrails

1. **Never `createAdminClient()`.** `apps/super-admin/lib/supabase/admin.ts` exports a service-role client that **bypasses RLS entirely**, and it is already imported in three places in this app — including `billing/actions.ts:193`, which reads the `members` table with it. Reaching for it here would produce a view that works perfectly in testing while silently bypassing FR-072's whole escalation gate: a non-escalated Super Admin would see everything. Use the RLS-bound `createClient()` from `@/lib/supabase/server`. **RLS is the authorization; the `escalated` flag is only a rendering hint.**
2. **`escalated` is a read-model convenience, not a permission check.** `page.tsx:56-58` says so in its own comment. Task 2's conditional fetch is belt-and-braces on top of RLS, not a substitute for it.
3. **Do not widen the column list.** Every `members` column — including `dob`, `emergency_contact`, `height_cm`, `starting_weight_kg`, and the whole body-profile set from `0066` — becomes readable the instant a Super Admin escalates. The RLS policy is row-level, not column-level; the only thing keeping this view proportionate is the explicit `.select()` allow-list in Task 1.
4. **`payments.method` is `text`, not an enum.** `0036_open_payment_method.sql:26` widened it and dropped the `payment_method` enum. Do not build an exhaustive method-label map assuming a closed set — render the raw value with an optional lookup, same fallback discipline as the role/status maps.

### Data Minimization

The column allow-list in Task 1 is the story's substantive privacy decision, and it has a direct precedent on this very page: Story 1.7's code review found that any Super Admin could read every *other* Super Admin's free-text escalation `reason`, on the reasoning that "a `reason` string can itself describe individual member/payment detail" — fixed by redacting it server-side before it reaches the client (`1-7-...md:187`, implemented at `page.tsx:65-78`). Extend that instinct, do not narrow it: send the minimum that makes support triage possible.

### Dependency on Story 1.15

Story 1.15 (Escalation Grant Expiry & Revocation) rewrites the two RLS policies this story reads through, moving the grant out of `audit_log` into a `gym_data_escalations` table with `expires_at`/`revoked_at`. **The policy names and their meaning to this story are unchanged** — `super_admin_escalated_read_members` / `super_admin_escalated_read_payments` still gate on "does this actor have an escalation for this gym" — so Task 1's service functions need no change either way. What changes is the *source* of the `escalated` flag in `page.tsx` (Task 2) and the fact that a grant can now lapse or be revoked between page loads.

Two consequences for this story's verification: Task 7 must additionally confirm that an **expired** grant and a **revoked** grant both render the page with no member/payment sections, and that the sections disappear on refresh after a revoke. Neither state exists before 1.15, so those checks are only meaningful once it has landed.

### Technical Requirements & Architecture Compliance

- `services/<domain>.ts` is the only layer allowed to call `supabase-js` outside Server Components/Actions; no component calls Supabase directly [Source: `architecture.md:446`].
- Service functions return `{ data, error }` and **never throw** for expected errors [Source: `architecture.md:231, 245`]. `AppError` is `{ code, message }` with an already-localized message [Source: `architecture.md:232`]. Build errors via `mapAndLog` (`services/gyms.ts:28-35`), never `mapSupabaseError` directly.
- `next.config.ts` sets `cacheComponents: true`, so **every** cookie-dependent Supabase read must sit inside an explicit `<Suspense>` boundary or the route throws "Uncached data ... accessed outside of Suspense" [Source: `gyms/page.tsx:12-19`]. The existing `GymDetailPage` → `<Suspense><GymDetailData/></Suspense>` split already provides this; keep the new fetches inside `GymDetailData` and do not hoist them.
- `apps/super-admin/AGENTS.md`: this Next.js version has breaking changes vs. typical training data. Check `node_modules/next/dist/docs/` before relying on any Next API — this repo has been bitten by stale external guides before.
- Raw JSX text is banned by `eslint-plugin-i18next`'s `no-literal-string` at error level, but `mode: "jsx-text-only"` means **attribute** strings (`aria-label`, `title`) are *not* caught (documented dead exclude list, `eslint.config.mjs:44-63`). Use `t()` for attributes too; lint will not catch you.

### Previous Story Intelligence

- **Story 1.7 is the direct parent** and its task list is **stale relative to shipped code**. 1.7's Task 3 specifies an `isGymDataAccessEscalated()` service function and an `escalated` field on `getGymDetail`'s return. **Neither exists.** `services/gyms.ts:167-175` documents the removal: it duplicated `listGymAuditTrail`'s query, used `auth.getUser()` (a network round trip) against this app's `getClaims()` convention, swallowed its own error indistinguishably from "not escalated", and could reject the whole `Promise.all`. `escalated` is now derived in `page.tsx:53-62`. **Read the code, not 1.7's task list.**
- **Story 1.7's own review added a 200-row cap** to `listGymAuditTrail` after shipping it unbounded (`1-7-...md:191`). Both new functions are paginated from the start for that reason — do not ship an uncapped `.select()`.
- **Stories 1.12 and 1.13** are the precedent for a user-raised, `epics.md`-absent Epic 1 story; 1.13's Dev Notes are the model for the "authority lives outside epics.md" framing used above.
- **`epics.md` documentation drift:** its visible headings stop at `### Story 1.10`; 1.11/1.12/1.13 were added via correct-course proposals and never backfilled (`sprint-status.yaml:4` flags this as a known gap). 1.14 continues that pattern. Do not "fix" `epics.md` as part of this story.

### Git Intelligence Summary

- HEAD is `d770f67` (`Revert "debug(mobile): record the photo flow to disk..."`). The last several commits are all `apps/mobile` photo-flow debugging — **nothing in recent history touches `apps/super-admin`**, so there is no in-flight work to collide with here.
- **The working tree is not clean at story-creation time.** An uncommitted Super Admin nav change is present (`components/AdminNavLink.tsx` new; `app/(admin)/layout.tsx`, `locales/{en,fr}.json` modified) from an ad-hoc pass on 2026-09-06. Both this story and that change edit `locales/{en,fr}.json`. Run `git status` before starting and do not attribute those changes to this story's commit.
- No migration will be added, so no migration-number collision check is needed (the highest existing is `0084_notification_history.sql`). If a reviewer asks for the `subscriptions` policy from Open Question 2, that becomes `0085` — confirm nothing else claimed it first.

### Testing Standards

- pgTAP via `supabase test db` is the only automated DB test layer. `apps/super-admin` has **no test runner at all** — no Vitest, no Playwright (`apps/dashboard` has both; this app has neither in its `package.json` scripts). Do not install one mid-story; this is a standing open decision on the retro action list, not this story's call.
- Consequently Task 7's manual verification is **required, not optional**, and is the only evidence for AC #1–#6.
- `pnpm --filter @gymos/super-admin typecheck` and `lint` must both come back clean. Note `PaymentProvidersPageClient.tsx` already emits one pre-existing `react-hooks/exhaustive-deps` warning — that is the known baseline, not a regression.

### Project Structure Notes

- **New:** `apps/super-admin/app/(admin)/gyms/[id]/components/GymMembersTable.tsx`, `.../GymPaymentsTable.tsx`.
- **Modified:** `apps/super-admin/services/gyms.ts`, `app/(admin)/gyms/[id]/page.tsx`, `.../components/GymDetailPageClient.tsx`, `.../loading.tsx`, `locales/{en,fr}.json`, `docs/decisions.md`.
- **Explicitly unchanged:** every file under `supabase/`, `packages/types/` (no schema change → no `database.ts` regeneration needed; `members`/`payments` Row types are already current and verified against the migrations), and `apps/dashboard/`.
- Nothing is shared with `apps/dashboard`. The only workspace package is `packages/types`, which holds Zod schemas, locales, `errors.ts`, `constants/`, and `database.ts` — **no React components**. Both apps duplicate their own `components/ui/`. Write these components fresh in `apps/super-admin`; do not import from `apps/dashboard`, and do not create a shared UI package for two tables.

### Open Questions for User/Architect Sign-Off

1. **Resolved (2026-09-06) — superseded by Story 1.15.** As originally written, this flagged that no audit entry is written when data is *viewed* (only when access is escalated, per 1.7's "one event, not two"), which combined with 1.7's permanent non-revocable grant meant one escalation yielded unlimited unlogged reads forever. The user chose to fix the underlying grant lifetime instead: **Story 1.15 adds a 24-hour TTL and revocation by any Super Admin.** Per-view logging is still not implemented and is still available as a future story, but the "forever" half of the objection is closed — access is now bounded whether or not anyone acts.
2. **Should `subscriptions` be escalation-readable?** Without it the member table has no plan or expiry, which is arguably the first thing a support operator would look for. Deliberately excluded here (needs a migration); raise it if the view proves thin in real use.

### References

- [Source: `_bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:537`] — FR-072, the binding constraint.
- [Source: `_bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:525-534`] — FR-071's V1 capability table (no member/payment row).
- [Source: `_bmad-output/planning-artifacts/architecture.md:448`] — Data Boundaries: the bypass "is the explicit, audit-logged escalation action."
- [Source: `_bmad-output/planning-artifacts/architecture.md:231, 232, 245, 446`] — `{ data, error }`, `AppError` shape, no-throw rule, service-layer boundary.
- [Source: `supabase/migrations/0012_super_admin_data_access_escalation.sql`] — the three policies this story consumes; adds none.
- [Source: `supabase/migrations/0073_tenant_suspension_enforcement.sql:117-126`] — RESTRICTIVE `tenant_active_gate` on `members`/`payments`; why suspended gyms must be verified (Task 7).
- [Source: `supabase/migrations/0036_open_payment_method.sql:26`] — `payments.method` widened to `text`.
- [Source: `supabase/migrations/0066_body_profile_progress_entry_logging.sql:25-26`] — body-profile columns now on `members`, deliberately not selected.
- [Source: `apps/super-admin/services/gyms.ts:28-35, 60-65, 74-143, 167-175, 240-277`] — `mapAndLog`, page shape, `listGyms` pagination, the `isGymDataAccessEscalated` removal note, `listGymAuditTrail`.
- [Source: `apps/super-admin/app/(admin)/gyms/[id]/page.tsx:26-88`] — Suspense split, `escalated` derivation, reason redaction, error branch.
- [Source: `apps/super-admin/app/(admin)/gyms/[id]/components/AuditTrailTab.tsx`] — the read-only section container and enum-label fallback pattern to copy.
- [Source: `apps/super-admin/app/(admin)/gyms/components/GymsPageClient.tsx:66-83, 193-291, 293-324`] — `updateParams`, table markup, numbered pager.
- [Source: `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx:79-99`] — the `i18n.language`-explicit formatting pattern.
- [Source: `ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:1478-1483`] — AD-12's read-only enforcement rules (AC #4).
- [Source: `ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:1100, 1314`] — 25 rows/page (members), 50 rows/page (payments).
- [Source: `ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:2146-2167`] — skeleton row-count precedents.
- [Source: `_bmad-output/planning-artifacts/epics.md:289, 291, 292, 293`] — UX-DR10 (states), UX-DR12 (`<table>`/a11y), UX-DR13 (column-hiding priority), UX-DR14 (EN/FR parity gate).
- [Source: `_bmad-output/implementation-artifacts/1-7-super-admin-escalated-gym-data-access.md:75-77, 187, 191`] — the deferred consumer, redaction precedent, the unbounded-query lesson.
- [Source: `docs/decisions.md:1232, 1234, 1248`] — audit_log-as-grant, no expiry/revocation, why aggregates were used instead of broad policies.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:493`] — existing i18n key-reuse problem on this page.

## Change Log

- 2026-09-06: Story created. Status backlog → ready-for-dev.
- 2026-09-06: Implementation complete (Tasks 1-8, all ACs verified). Status ready-for-dev → in-progress → review.

## Dev Agent Record

### Agent Model Used

Claude (dev-story workflow), 2026-09-06.

### Debug Log References

None — no blocking issues encountered. `services/gyms.ts`, `page.tsx`, and both new table components typechecked and linted clean on first full pass; the only iteration was aligning the two new tables' pagination controls to `GymsPageClient`'s exact chevron-icon shape (Task 3's "verbatim in shape" instruction) after an initial pass used plain text buttons.

### Completion Notes List

**All tasks complete, all 7 ACs verified live in the browser by smartsana on 2026-09-06. Status → review.**

Story 1.15 had already landed on `master` (merged via PR #4) before this story started, so the dependency note at the top of this file no longer applied — `page.tsx` was already deriving `escalated` from `getActiveEscalationForCurrentActor()`, confirmed by reading the code before writing anything (Dev Notes → Previous Story Intelligence's own warning to read the code, not stale task lists, taken seriously here too).

**What was built**, matching Tasks 1-6 and 8 exactly as specified — no scope added, none skipped:

- `listGymMembers()` / `listGymPayments()` in `services/gyms.ts`, mirroring `listGyms`'s exact `{ rows, total, page, pageSize }` shape, RLS-bound `createClient()` only, the explicit column allow-list from Dev Notes → Data Minimization, and no Actor column (no Super Admin SELECT policy exists on `public.users`). `join_date desc, id desc` / `created_at desc, id desc` ordering, matching the story's own tiebreak reasoning.
- `page.tsx` gained `searchParams: Promise<{ mpage?: string; ppage?: string }>`, forwarded unawaited to stay inside the `<Suspense>` boundary (`cacheComponents: true`). The two new fetches are conditional on `escalated` and issued in a *second* `Promise.all`, after the first batch (which includes `getActiveEscalationForCurrentActor`) has already resolved and been checked for errors -- not joined into the first batch, per the story's explicit instruction. A second error check follows the same `common.loadError` rendering as the first, since `membersError`/`paymentsError` don't exist until after `escalated` is known.
- `GymMembersTable.tsx` / `GymPaymentsTable.tsx`: new client components, `null` prop renders `null` (not escalated), copy `AuditTrailTab`'s exact container, `GymsPageClient`'s exact table markup plus the `scope="col"` it was missing, and its exact chevron-icon pager (windowed to `MAX_PAGE_BUTTONS = 7` rather than `GymsPageClient`'s unbounded `Array.from({ length: totalPages })`, which is only safe at gym-list scale). Zero edit/delete/checkbox/row-click affordances (AC #4). `i18n.language` passed explicitly to every `toLocaleString()` call -- the bare-call inconsistency in `AuditTrailTab.tsx:50` was deliberately not copied.
- i18n: `gyms.memberRecords.*` / `gyms.paymentRecords.*`, sibling namespaces to `gyms.auditTrail.*`, own dedicated keys (no reuse of `gyms.table.*`), role/status sub-maps with the same `t() ?? raw` fallback pattern as `AuditTrailTab`'s `ACTION_LABEL_KEY`.
- `loading.tsx` extended with 8 member-row and 6 payment-row skeleton blocks per `EXPERIENCE.md`'s precedent table.
- `docs/decisions.md`: one dated entry recording the members+payments-only scope, the four/six excluded tables and why, the column allow-list's FR-072 reasoning, and the no-per-view-audit-entry decision's now-bounded status post-1.15.
- **Zero migrations, zero new RLS policies (AC #7)** -- confirmed by `git diff --stat` showing no file under `supabase/` in this story's changes.

**Task 6 (pgTAP regression):** ran the full suite as a pure regression gate, added nothing new (`gym_data_escalation_rls.test.sql` stays at `plan(9)`, unrenumbered). Real observed count, not copied forward from either figure the story warned about: **86 files, 1800 assertions, 0 failures.**

**Task 7 (manual verification) — the only evidence for AC #1-6, per this app's own Testing Standards (no test runner exists for `apps/super-admin`).** Ran live against the local Supabase instance with smartsana, reusing the admin-a/admin-b Super Admin accounts Story 1.15 left provisioned. Iron Peak Fitness was seeded to 29 members across all 5 non-owner roles (3 deactivated) and 5 payments across every `payment_status` value with varied methods and reason text -- large enough to force a genuine second page of Member records (25/page) and exercise every label-mapping branch. A second gym, Quiet Peak Gym (1 owner-only member, 0 payments), was seeded specifically for AC #5's empty-state distinction. Every AC was confirmed as its own discrete step, not a single end-to-end "looks fine" pass:

- **AC #1** — with admin-a NOT escalated, View Page Source + search for a seeded member's name returned no match. The server never sent the row; nothing was merely hidden client-side.
- **AC #2** — mixed roles rendered with correct labels, deactivated rows showed correctly, 25/page pagination genuinely produced a second page.
- **AC #3** — payment rows rendered with member name (resolved via the `members ( name )` embed), amount, method, status label, date, and reason text.
- **AC #4** — no click, checkbox, or edit affordance on any row of either table.
- **AC #5** — Quiet Peak Gym's Payment records showed the empty-state copy for zero rows; its Member records showed exactly one row (the owner) rather than empty-state copy, confirming those are genuinely different states, not the same condition worded two ways.
- **AC #6** — full French pass: section titles, column headers, and every role/status label rendered translated, no English strings.
- **AC #7's operational counterpart (the suspended-gym check)** — the story's own flagged highest-risk regression surface. Iron Peak Fitness was suspended via a real `super_admin`-claim session (not a superuser bypass, which the table's own protective trigger would have silently reverted) while admin-a's grant was still live; both sections remained fully populated on reload, confirming `0073`'s RESTRICTIVE `tenant_active_gate`'s `or private.is_super_admin()` clause does what it claims. Gym restored to `active` immediately after.
- **The per-actor security boundary** -- arguably the most important single check in this story, run explicitly rather than assumed from AC #1 alone: admin-b, a Super Admin with **no grant of their own** on Iron Peak Fitness, saw neither section. Escalation gates per-actor, not "any Super Admin sees everything."

**Task 7's seed data was rolled back after verification, not left in place.** The first full-suite run after seeding (86 files, 1800 assertions) came back with 2 failures -- `gyms_super_admin_rls.test.sql` and `payment_reconciliation_job.test.sql` -- both asserting unqualified platform-wide counts that the seeded rows (a second gym, 27 extra members, 2 extra payments) shifted. Confirmed these were caused by the seed data and not by this story's code: deleted the seed rows (restoring Iron Peak Fitness to its pre-Task-7 state of 2 members/3 payments, and removing Quiet Peak Gym entirely) and re-ran the full suite clean at **86 files, 1800 assertions, 0 failures** -- the same number Task 6 observed before Task 7 began. Leaving a shared local dev database in a state that breaks the automated suite for the next person is avoidable and was avoided.

**Local environment left running:** super-admin dev server on `:3000`; admin-a/admin-b unchanged from Story 1.15's provisioning; admin-a's escalation grant on Iron Peak Fitness (from Step 2 of the manual walkthrough) is still live and will lapse on its own 24-hour schedule.

### File List

**New:**
- `apps/super-admin/app/(admin)/gyms/[id]/components/GymMembersTable.tsx`
- `apps/super-admin/app/(admin)/gyms/[id]/components/GymPaymentsTable.tsx`

**Modified:**
- `apps/super-admin/services/gyms.ts` (added `listGymMembers`, `listGymPayments`, `GymMemberRow`/`GymMemberPage`/`GymPaymentRow`/`GymPaymentPage` types)
- `apps/super-admin/app/(admin)/gyms/[id]/page.tsx` (`searchParams` for `mpage`/`ppage`, conditional member/payment fetch)
- `apps/super-admin/app/(admin)/gyms/[id]/components/GymDetailPageClient.tsx` (mounts the two new tables)
- `apps/super-admin/app/(admin)/gyms/[id]/loading.tsx` (two more skeleton blocks)
- `apps/super-admin/locales/en.json` / `fr.json` (`gyms.memberRecords.*`, `gyms.paymentRecords.*`)
- `docs/decisions.md` (one dated entry)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow tracking)
- `_bmad-output/implementation-artifacts/1-14-super-admin-member-payment-data-view.md` (this file)

**Explicitly unchanged, as the story required:** everything under `supabase/`, `packages/types/`, `apps/dashboard/`.
