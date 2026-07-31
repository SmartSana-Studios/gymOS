---
baseline_commit: 6a74be25ca514d5deafc2a6aac1c0d6b236b89d9
---

# Story 3.10: Member App — Plan Details & Check-In History

Status: done

## Story

As a member,
I want to view my plan details and past check-ins,
so that I can track my own attendance and membership terms without asking the front desk.

## Acceptance Criteria

1. **Given** the History screen's Check-ins tab, **when** I view it, **then** it shows a reverse-chronological, paginated list of my check-ins, or "No check-ins yet. Scan the QR at your gym to get started." if empty. [Source: epics.md#Story 3.10; FR-062; EXPERIENCE.md#MA-11]
2. **Given** the Plan Details screen, **when** I view it, **then** I see plan type, price, duration, active-from date, expiry date, and billing interval as read-only. [Source: epics.md#Story 3.10; FR-062; EXPERIENCE.md#MA-13]

**Explicitly out of scope (epics.md's own note, do not build):** the History screen's Payments tab data and the Payment Detail (receipt) view — delivered in Epic 4, Story 4.9, once payment records exist. The Payments *tab itself* (segmented control option) is built now as a static empty state — see Scope Note #4.

## Tasks / Subtasks

- [x] **Task 1: Extract shared subscription-status badge constants** (AC #2; Scope Note #1)
  - [x] New `apps/mobile/src/constants/subscription-status.ts`: move `SubscriptionStatus`, `BadgeStatus`, `SUBSCRIPTION_STATUSES`, `isSubscriptionStatus`, `STATUS_COLORS`, and the `statusLabelKey` record verbatim out of `apps/mobile/src/app/(tabs)/index.tsx` (currently inline, lines ~19–25, 63–69, 219–225) — no behavior change, just relocating so Plan Details (Task 3) can reuse the identical 5-state mapping instead of redefining it.
  - [x] Update `index.tsx` to import from the new module; confirm `pnpm typecheck` still passes with zero behavior change.

- [x] **Task 2: History screen — new 4th tab** (AC #1)
  - [x] New `apps/mobile/src/app/(tabs)/history/index.tsx` (nested folder, not a flat `history.tsx` — leaves room for Epic 4 Story 4.9's `history/payment/[id].tsx` per architecture.md's directory tree, without a later restructure).
  - [x] Segmented control: "Payments" | "Check-ins", local `useState<'payments' | 'checkins'>` — **default to `'checkins'`**, not `'payments'` (Scope Note #4: the Payments tab has no real data in this story; defaulting to it would show a new member an empty state before their actual check-in history).
  - [x] **Check-ins tab:** on mount, resolve own `members.id` (identical `user_id`/`deactivated_at`/`order(created_at desc).order(id desc)`/`.limit(1).single()` block already used in `index.tsx`/`profile.tsx`/`onboarding/plan.tsx` — copy it, this app has no shared "resolve my member id" helper, matching its existing per-screen duplication convention) and the gym's `name` (`.from('gyms').select('name').single()`, fetched once, not per-row). Then load page 0 of check-ins (Task 2's query, below).
  - [x] Query: `supabase.from('attendance_events').select('id, checked_in_at, checked_out_at').eq('member_id', memberId).order('checked_in_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 19)` — `member_read_own_attendance_events` RLS policy (0026 migration) already permits this; **no new migration needed**. `PAGE_SIZE = 20` per EXPERIENCE.md.
  - [x] Render via `FlatList` (first use of `FlatList` in this app — every existing screen uses `ScrollView`/`map()`; required here for `onEndReached` infinite scroll + native `refreshing`/`onRefresh` pull-to-refresh, both absent from this app until now). Row: date+time (left, reuse/duplicate `formatCheckInTimestamp` from `index.tsx`), gym name (center), duration (right) — **duration column is blank when `checked_out_at` is null** (EXPERIENCE.md literally says "duration if checked-out"; don't invent an "still open" placeholder — that's a dashboard-only need for staff, not a member viewing their own history).
  - [x] Duration format for a closed session: hours + minutes (e.g. "1h 23m"), same arithmetic as `apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx`'s `formatDuration` (`Math.round(ms/60000)`, then `Math.floor(totalMinutes/60)` + `% 60`) — reimplement locally with new mobile i18n keys (mobile locales are a separate file per architecture.md, don't import the dashboard's `attendance.durationFormat` key).
  - [x] `onEndReached`: fetch the next page (`offset += 20`); stop paginating once a page returns fewer than 20 rows. Pull-to-refresh (`onRefresh`): reset `offset` to 0, replace state (not append).
  - [x] Empty state (zero check-ins, page 0 only): "No check-ins yet. Scan the QR at your gym to get started." + a button that does `router.push('/checkin')`.
  - [x] Loading state: `ActivityIndicator` (not a skeleton) — EXPERIENCE.md mocks 5–6 skeleton rows, but **no skeleton component exists anywhere in this app** (`index.tsx`/`profile.tsx`/`onboarding/plan.tsx` all use a plain `ActivityIndicator`); introducing the first skeleton system in this story is out of scope, matching this app's existing loading-state convention.
  - [x] **Payments tab:** static content only, no query — render `t('history.payments.empty')` ("No payments on record yet."). Not tappable, no button. This is intentionally the entire Payments tab for this story (Scope Note #4).
  - [x] Pull-to-refresh: EXPERIENCE.md specifies it "on both tabs" — since the Payments tab has no data to refresh, a no-op/absent `RefreshControl` there is acceptable; don't build a fake refresh spinner with nothing behind it.

- [x] **Task 3: Wire the History tab into the tab bar** (AC #1)
  - [x] `apps/mobile/src/components/app-tabs.tsx`: add a `<NativeTabs.Trigger name="history">` between the existing `checkin` and `profile` triggers (EXPERIENCE.md's tab order: Home → Check-In → History → Profile). Icon: `sf="clock.arrow.circlepath" md="history"` (same `sf`/`md` prop pattern as the existing `checkin` trigger's `qrcode.viewfinder`/`qr_code_scanner` — no new PNG asset needed). **Verify both symbol names exist for the installed SDK** against https://docs.expo.dev/versions/v57.0.0/ (`expo-router/unstable-native-tabs` is explicitly `unstable` — per `apps/mobile/AGENTS.md`, confirm the trigger API shape hasn't shifted before writing this).
  - [x] Do **not** update `apps/mobile/src/components/app-tabs.web.tsx` — it's unmaintained Expo-starter boilerplate (still says "Expo Starter" branding, links to generic Expo docs) that no prior mobile story (2.6–3.9) has kept in sync with `app-tabs.tsx`; out of scope here too.

- [x] **Task 4: Plan Details screen — new modal route** (AC #2; Scope Note #2)
  - [x] New `apps/mobile/src/app/plan.tsx` — a **top-level** route (sibling to the `(tabs)` and `onboarding` groups), not inside `(tabs)/`. Architecture.md's directory tree annotates MA-13 as "reached as a modal route from Home/History," which this repo has no prior example of — this is the first modal route in the app.
  - [x] Register it in `apps/mobile/src/app/_layout.tsx`'s `RootNavigator`, inside the existing `<Stack.Protected guard={isFullyOnboarded}>` block (alongside `(tabs)`): `<Stack.Screen name="plan" options={{ presentation: 'modal', headerShown: false }} />`. Gating it on `isFullyOnboarded` (not adding an ungated top-level screen) keeps it consistent with the rest of the reachable-route-tree logic already documented on that file (an onboarding-incomplete session must never reach it).
  - [x] On mount, resolve own `members.id` (same duplicated block as Task 2), then:
    ```
    supabase.from('subscriptions')
      .select('status, start_date, expiry_date, plans(name, plan_type, price, currency, billing_interval, duration_days)')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(1).single()
    ```
    **Do not** add `.eq('status', 'active')` — copy `index.tsx`'s Home-screen query shape (which deliberately omits that filter, Story 3.7 Scope Note #4), not `onboarding/plan.tsx`'s (which filters to `active` because onboarding only ever runs against a brand-new active subscription). An `expiring_soon`/`grace_period`/`expired` member must still be able to view their plan.
  - [x] `gym_staff_read_own_subscriptions` (0018 migration) and `gym_staff_read_own_plans` (0017 migration) already permit this exact read for a member session — **no new migration**. (0018's own comment literally names "the member app's own Plan Details screens, Story 2.7/3.10" as this policy's reason for existing.)
  - [x] Card fields, all read-only: plan type (mapped label, new task below), price + currency (`{{price}} {{currency}}`, same as `onboarding/plan.tsx`), duration (reuse the exact `durationLabel` logic from `onboarding/plan.tsx` — `pay_per_session` or null `duration_days` → "No fixed duration" i18n key, else `"{{count}} days"` pluralized key; **do not** invent a days→months conversion — EXPERIENCE.md's "Duration: 1 month" mockup text is illustrative of a monthly plan's day count, not a required unit-conversion feature this codebase doesn't have elsewhere), active-from date (`formatDateOnly(start_date)`, duplicate the helper — this app already duplicates it in two files rather than sharing it), expiry date (`formatDateOnly(expiry_date)` or a "no expiry" key, mirroring `onboarding/plan.tsx`'s `noExpiry`), billing interval (new mapped label: "Monthly"/"Annual").
  - [x] Status badge (top-right of the card, per EXPERIENCE.md's mockup) using Task 1's shared `STATUS_COLORS`/label map — same visual treatment as Home's status card (including the grace-period warning icon). This field isn't in the epics.md AC's literal 6-item list but is in the mockup and costs nothing extra now that Task 1 extracted the mapping; include it.
  - [x] Access description row (mockup's "Access: Floor access" line) — **not a stored column**; mirror `apps/dashboard/app/(dashboard)/plans/planLabels.ts`'s `ACCESS_DESCRIPTION_KEY` pattern exactly (a `plan_type`-keyed constant of hardcoded, PRD-sourced description strings, not a database field) but with new mobile-locale keys. Also not in the epics.md AC list; include for the same low-cost/mockup-fidelity reason as the status badge.
  - [x] Back button (`←`, `router.back()`) matching `onboarding/plan.tsx`'s exact `backButton` pattern — modal dismissal, not a stack pop into a wrong screen.
  - [x] Loading/error states: `ActivityIndicator` + a load-failure card with a "Try again" retry action, same shape as every other screen in this app (`index.tsx`, `profile.tsx`, `onboarding/plan.tsx`). A member with literally zero subscription rows (shouldn't normally happen post-onboarding, but defend anyway) gets a distinct non-retryable message, same `PGRST116`-code branch pattern used in all three reference files.

- [x] **Task 5: Wire real navigation from Home** (AC #1, #2)
  - [x] `apps/mobile/src/app/(tabs)/index.tsx`: replace the two no-op `handleViewPlan(){}` call sites (the status-card `Pressable` and the "View Plan" quick-action button) with `() => router.push('/plan')`. Delete the now-stale comment above `handleViewPlan` that says Story 3.10 will wire this ("neither MA-13... nor the History screen exists yet") — both now exist.
  - [x] Recent-activity rows (currently a plain, non-interactive `View` per row): wrap each in a `Pressable` that does `router.push('/history')` — EXPERIENCE.md: "check-in rows navigate to History, payment rows navigate to MA-14." Only check-in rows exist today (no payments table yet), so every recent-activity row goes to `/history` for now.

- [x] **Task 6: i18n — new `history.*` and `plan.*` top-level namespaces** (AC #1, #2)
  - [x] Add to `apps/mobile/src/locales/en.json` and `fr.json` (new top-level keys, sibling to `home`/`checkin`/`profile`/`onboarding`; `plan` is a **new namespace distinct from the existing `onboarding.plan`** — different screen, different copy needs, same disambiguation the codebase already makes between `onboarding.profile` and top-level `profile`):
    - `history.title`, `history.tabPayments`, `history.tabCheckins`, `history.payments.empty`, `history.checkins.empty`, `history.checkins.checkInButton`, `history.checkins.durationFormat` (e.g. `"{{hours}}h {{minutes}}m"`), `history.checkins.errorLoadFailed`.
    - `plan.title`, `plan.type.payPerSession`/`monthly`/`coachInclusive`/`classOnly`, `plan.access.payPerSession`/`monthly`/`coachInclusive`/`classOnly` (copy the four description strings verbatim from `apps/dashboard/locales/en.json`'s `plans.accessDescriptions.*` and `fr.json`'s French equivalents — same underlying PRD-sourced facts, just re-homed under mobile's own locale namespace), `plan.priceLabel`, `plan.durationLabel`, `plan.durationDays_one`/`_other`, `plan.noFixedDuration`, `plan.activeFromLabel`, `plan.expiryLabel`, `plan.noExpiry`, `plan.billingLabel`, `plan.billingMonthly`, `plan.billingAnnual`, `plan.accessLabel`, `plan.errorLoadFailed`, `plan.errorNoSubscription`.
  - [x] French translations: match this file's existing tone (see `onboarding.plan.*`/`home.*` FR entries already in `fr.json`) — don't machine-translate blindly (UX-DR14).
  - [x] Run `node scripts/check-i18n-key-parity.mjs` before finishing — it already walks `apps/mobile/src/locales` (added in Story 2.6).

- [x] **Task 7: Verification**
  - [x] `pnpm typecheck` (all 4 packages) passes.
  - [x] `node scripts/check-i18n-key-parity.mjs` passes.
  - [x] **No migration, no pgTAP change, no `supabase gen types` regen needed** — this story adds zero schema/RLS/RPC surface (Task 4's read is already covered by 0017/0018; Task 2's read is already covered by 0026). If any implementation step turns out to need a new policy, stop and re-check Task 2/4's cited migrations first — that would mean a wrong assumption slipped in, not a genuine gap.
  - [x] Manually verify AC #1 and #2: if no device/simulator session is available in this environment (the same limitation Stories 3.6–3.9 documented), verify via direct queries against the local Postgres instance under a simulated member session (`set local role authenticated` + `set_config('request.jwt.claims', ...)`, the exact fallback those stories used) — confirm the `attendance_events` pagination query and the `subscriptions`+`plans` join both return the expected shape for a seeded member with several check-ins and an active subscription. Say so explicitly in Completion Notes if this fallback is used.

## Dev Notes

This story is **mobile-UI-only** — no new migration, RLS policy, or RPC. Every read this story needs is already authorized by existing policies (0017, 0018, 0026), two of which (0018, 0026) explicitly name this story or its screens in their own migration comments as the reason they were written ahead of time. Don't go looking for a gap that isn't there.

### Scope Note #1 — Why the status-badge mapping gets extracted, not duplicated

Every other small helper duplicated across screens in this app (`formatDateOnly`, member-id resolution) is a one-off pure function cheap enough to copy-paste per the app's established convention. `STATUS_COLORS`/`statusLabelKey` is a 5-entry color+i18n-key table that Plan Details now needs byte-identical to Home's — duplicating a table (vs. a one-line function) is a real drift risk (a future subscription-status addition would need updating in two places to avoid silently diverging), so this is the one exception: extract to `constants/subscription-status.ts` before Task 3 needs it.

### Scope Note #2 — Plan Details is a new *kind* of route in this app

Every existing screen is either inside `(tabs)/` or inside `onboarding/`, both gated as whole `Stack.Protected` groups in `app/_layout.tsx`. Plan Details is the first screen reachable *from within* the already-onboarded experience that isn't itself a bottom tab — it must be a sibling `Stack.Screen` to `(tabs)`, gated by the same `isFullyOnboarded` boolean, with `presentation: 'modal'`. Don't nest it inside `(tabs)/` (it would then need its own tab-bar-hiding logic that doesn't exist in this app) and don't leave it ungated at the Stack root (an onboarding-incomplete session could then reach it directly by URL/deep link).

### Scope Note #3 — "Access" and the status badge aren't in epics.md's AC text, but are in the mockup

Epics.md's Story 3.10 AC #2 lists exactly six fields (plan type, price, duration, active-from, expiry, billing interval). EXPERIENCE.md's MA-13 mockup additionally shows a status badge and an "Access: Floor access" row. Both are included in this story (Task 4) because: (a) the cost is near-zero — the status badge reuses Task 1's already-extracted table, and the access description mirrors a pattern (`ACCESS_DESCRIPTION_KEY`) the dashboard already built and validated for the identical `plan_type` set; (b) UX-mockup fidelity is a first-class requirement throughout this project (UX-DR1–DR16). This is a deliberate scope decision, not an oversight — don't remove either field for being "not in the AC," and don't spend extra time trying to justify them further.

### Scope Note #4 — Payments tab is a real, empty tab; default tab is Check-ins

The Payments tab in the History screen's segmented control gets built now (so the control has two real options, matching the mockup exactly) but shows only a static "No payments on record yet." string — there is no `payments` table yet (Epic 4 hasn't started), so there is nothing to query. Default the segmented control to **Check-ins**, not Payments (EXPERIENCE.md's diagram lists "Payments | Check-ins" left-to-right, which is a layout order, not a stated default-selection rule) — landing a member on a guaranteed-empty tab first, when their real check-in history is one tap away, would be a worse first impression than the mockup intends.

### Project Structure Notes

- New: `apps/mobile/src/constants/subscription-status.ts`, `apps/mobile/src/app/(tabs)/history/index.tsx`, `apps/mobile/src/app/plan.tsx`.
- Modified: `apps/mobile/src/app/(tabs)/index.tsx` (status constants extracted out; `handleViewPlan` wired; recent-activity rows made tappable), `apps/mobile/src/components/app-tabs.tsx` (new History trigger), `apps/mobile/src/app/_layout.tsx` (new `plan` Stack.Screen), `apps/mobile/src/locales/{en,fr}.json` (new `history.*`/`plan.*` namespaces).
- Not modified (deliberately): `apps/mobile/src/components/app-tabs.web.tsx` (unmaintained starter boilerplate, Scope Note in Task 3), any `supabase/migrations/*` file, `packages/types/src/database.ts` (no schema change to regenerate).
- No new top-level folders beyond `(tabs)/history/` — matches the architecture.md tree's own anticipated shape for MA-11/MA-14.

### Testing Standards Summary

- No mobile unit/component test runner exists in this repo (unchanged since Story 3.8) — no pgTAP either, since nothing in Postgres changes. Verification is manual/device (or the direct-query fallback) only.
- `check-i18n-key-parity.mjs` must pass after adding `history.*`/`plan.*` to both locale files.
- Run any `supabase`/Docker commands from **WSL**, not native PowerShell, if you do end up needing to inspect local data for verification (project memory `project_supabase_wsl`) — though this story should not need to touch `supabase/migrations/` at all.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.10; FR-062 (via epics.md's Requirements Inventory and FR Coverage Map, "Epic 3 - Member view of plan details + check-ins (payment-history portion completed in Epic 4, Story 4.9)")]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-11 "History" (lines 717–748), #MA-13 "Plan Details" (lines 790–813), MA-09/MA-11/MA-13 navigation table (lines 52–58, 110–119, 583–585)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Project Structure's `apps/mobile/app/(tabs)/history/index.tsx` (MA-11) and `history/payment/[id].tsx` (MA-14, Epic 4); "MA-13 Plan Details reached as a modal route from Home/History" comment]
- [Source: supabase/migrations/0017_membership_plan_configuration.sql lines 70–75 (`gym_staff_read_own_plans`, ungated by role); 0018_member_management.sql lines 220–238 (`gym_staff_read_own_subscriptions`, comment explicitly names "Story 2.7/3.10"); 0026_member_app_home_screen_status_display.sql (`member_read_own_attendance_events`)]
- [Source: apps/mobile/src/app/(tabs)/index.tsx — `STATUS_COLORS`/`statusLabelKey`/`isSubscriptionStatus` (to be extracted), `formatDateOnly`/`formatCheckInTimestamp` helpers, `handleViewPlan` stub and its Story-3.10-forward-reference comment, non-interactive recent-activity rows]
- [Source: apps/mobile/src/app/onboarding/plan.tsx — subscription+plan query shape (`status='active'` filtered — do NOT copy that filter for Plan Details), `durationLabel`/`formatDateOnly`/plan-card layout to mirror]
- [Source: apps/mobile/src/app/(tabs)/profile.tsx — another example of the member-id-resolution + `PGRST116` "no active plan" distinction pattern]
- [Source: apps/mobile/src/components/app-tabs.tsx — existing `NativeTabs.Trigger` shape (`sf`/`md` icon props on the `checkin` trigger) to copy for the new `history` trigger]
- [Source: apps/mobile/src/app/_layout.tsx — `RootNavigator`'s `Stack.Protected` gating, where the new `plan` `Stack.Screen` is added]
- [Source: apps/dashboard/app/(dashboard)/plans/planLabels.ts — `PLAN_TYPE_LABEL_KEY`/`ACCESS_DESCRIPTION_KEY` pattern to mirror (new mobile-locale keys, not imported directly — mobile locales are a separate file per architecture.md)]
- [Source: apps/dashboard/app/(dashboard)/attendance/components/AttendancePageClient.tsx — `formatDuration` arithmetic to mirror for the Check-ins tab's duration column]
- [Source: scripts/check-i18n-key-parity.mjs — already includes `apps/mobile/src/locales` (added Story 2.6)]
- [Source: _bmad-output/implementation-artifacts/3-9-member-app-offline-check-in-queueing.md — Dev Notes/Scope Note structure and "no test runner, direct-RPC/query fallback" verification precedent this story follows]
- [Source: https://docs.expo.dev/versions/v57.0.0/sdk/router/ — `unstable-native-tabs` trigger API and Stack modal `presentation` option, fetched 2026-07-29; verify before writing `app-tabs.tsx`/`_layout.tsx` changes per `apps/mobile/AGENTS.md`]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `pnpm typecheck` (all 4 packages): pass.
- `node scripts/check-i18n-key-parity.mjs`: pass (149 keys, en/fr in parity).
- No mobile device/simulator session available in this environment (same limitation as Stories 3.6–3.9) — AC #1 and AC #2 were verified via direct queries against the local Postgres instance (run from WSL/Docker per project memory `project_supabase_wsl`) under a simulated member session (`set local role authenticated` + `set_config('request.jwt.claims', '{"sub":...,"role":"authenticated","gym_id":...,"app_role":"member"}', true)`), matching the fallback Stories 3.6–3.9 documented. Seeded (inside a `begin; ... rollback;` block, so the local instance was left unchanged) one gym/member/plan/subscription plus 3 `attendance_events` (2 closed, 1 open) as the connecting role, then re-ran both story queries as the member session:
  - AC #1: the `attendance_events` pagination query (`order by checked_in_at desc, id desc limit 20 offset 0`) returned all 3 rows in reverse-chronological order; the open session's `checked_out_at` was null (blank-duration case), the two closed sessions' `checked_in_at`/`checked_out_at` deltas matched the seeded 1h23m and 45m durations exactly.
  - AC #2: the `subscriptions` + `plans` join (`order by created_at desc limit 1`) returned the seeded active subscription with all 6 AC-listed fields (plan type, price, duration, active-from, expiry, billing interval) correctly joined.
  - A same-transaction sanity check confirmed `member_read_own_attendance_events` still scopes strictly to the caller's own `member_id` (0 rows for any other member).

### Completion Notes List

- Tasks 1, 3, 4, 5 (subscription-status extraction, tab-bar trigger, Plan Details modal route, Home-screen navigation wiring) were already implemented going into this session; this session completed Task 2 (History screen — verified against spec, no changes needed), and wrote the missing Task 6 i18n keys (`history.*`/`plan.*` namespaces in `en.json`/`fr.json`, en/fr in parity), then ran and passed Task 7's full verification suite.
- `NativeTabs.Trigger.Icon`'s `sf="clock.arrow.circlepath" md="history"` pair (Task 3) was spot-checked against the Expo v57 native-tabs docs — the `sf`/`md`-prop pattern and dot-separated SF Symbol naming both matched the documented shape (docs didn't show `sf`+`md` used together in one example, but the existing `checkin` trigger already does so and typechecks/renders, so this is consistent with an established in-repo pattern, not a novel risk).
- No migration, RLS policy, RPC, or `packages/types/src/database.ts` regen was needed — confirmed both reads are fully covered by existing policies (0017, 0018, 0026), per Dev Notes.

### File List

- `apps/mobile/src/constants/subscription-status.ts` (new)
- `apps/mobile/src/app/(tabs)/history/index.tsx` (new)
- `apps/mobile/src/app/plan.tsx` (new)
- `apps/mobile/src/app/(tabs)/index.tsx` (modified: subscription-status constants extracted to the new module; `handleViewPlan` and recent-activity rows wired to real navigation)
- `apps/mobile/src/components/app-tabs.tsx` (modified: new `history` tab trigger)
- `apps/mobile/src/app/_layout.tsx` (modified: new `plan` modal `Stack.Screen`)
- `apps/mobile/src/locales/en.json` (modified: new `history.*`/`plan.*` namespaces)
- `apps/mobile/src/locales/fr.json` (modified: new `history.*`/`plan.*` namespaces)

### Review Findings

- [x] [Review][Patch] History screen (MA-11) has no navigation path to Plan Details (MA-13) [apps/mobile/src/app/(tabs)/history/index.tsx] — EXPERIENCE.md's IA tree lists "History → Plan Details" as a nav edge with no in-story scope note excluding it (unlike Payment Detail, explicitly deferred to Epic 4). Resolved: add a header-level "View Plan" entry point on the History screen (not per-row, since check-in rows don't map to a specific plan) that calls `router.push('/plan')`.

- [x] [Review][Patch] Failed load-more/refresh wipes the entire already-loaded check-in list [apps/mobile/src/app/(tabs)/history/index.tsx:70-93,188-199]
- [x] [Review][Patch] Offset-based pagination can drift/duplicate rows under concurrent check-ins (no cursor) [apps/mobile/src/app/(tabs)/history/index.tsx:70-84]
- [x] [Review][Patch] handleRefresh and handleEndReached are not mutually exclusive (race condition) [apps/mobile/src/app/(tabs)/history/index.tsx:132-156]
- [x] [Review][Patch] Plan Details status badge missing the grace-period warning icon required by Task 4 [apps/mobile/src/app/plan.tsx:~686-690]
- [x] [Review][Patch] Segmented control render order reversed vs. mockup, beyond what Scope Note #4 justified [apps/mobile/src/app/(tabs)/history/index.tsx:165-179]
- [x] [Review][Patch] isSubscriptionRow doesn't validate the nested plans object's field shape [apps/mobile/src/app/plan.tsx:61-70]
- [x] [Review][Patch] Segmented control uses accessibilityRole="button" instead of tab semantics [apps/mobile/src/app/(tabs)/history/index.tsx:166-179]
- [x] [Review][Patch] PLAN_TYPE_LABEL_KEY/ACCESS_DESCRIPTION_KEY typed as Record<string,string> instead of Record<PlanType,string>, masking a silent fallback [apps/mobile/src/app/plan.tsx:18-25,187-188]

- [x] [Review][Defer] Unfiltered `.single()` on `gyms` table assumes exactly one row exists [apps/mobile/src/app/(tabs)/history/index.tsx:110] — deferred, pre-existing (identical in index.tsx:118, profile.tsx:78)
- [x] [Review][Defer] New "History" tab label is hardcoded English [apps/mobile/src/components/app-tabs.tsx:29] — deferred, pre-existing (every other tab label in this file is also hardcoded)
- [x] [Review][Defer] Async load failures are silently swallowed with no logging [apps/mobile/src/app/(tabs)/history/index.tsx, apps/mobile/src/app/plan.tsx] — deferred, pre-existing (zero console.error/warn usage anywhere in apps/mobile/src/app/)
- [x] [Review][Defer] Negative/anomalous check-in durations silently clamped to zero [apps/mobile/src/app/(tabs)/history/index.tsx:37-40] — deferred, pre-existing (identical arithmetic to dashboard's `AttendancePageClient.formatDuration`, mirrored per spec)
- [x] [Review][Defer] Unlocalized, unformatted currency/price display [apps/mobile/src/app/plan.tsx] — deferred, pre-existing (mirrors `onboarding/plan.tsx`'s identical formatting per spec)
- [x] [Review][Defer] Deactivated/removed member gets a generic, non-recoverable retry loop [apps/mobile/src/app/plan.tsx, apps/mobile/src/app/(tabs)/history/index.tsx] — deferred, pre-existing (identical in index.tsx, profile.tsx)
- [x] [Review][Defer] Rapid double-tap can stack duplicate `/plan` modal screens [apps/mobile/src/app/(tabs)/index.tsx handleViewPlan] — deferred, pre-existing (no navigation Pressable in the app guards against double-tap)
- [x] [Review][Defer] Retry buttons have no in-flight guard, stale response can overwrite fresher data [apps/mobile/src/app/plan.tsx, apps/mobile/src/app/(tabs)/history/index.tsx] — deferred, pre-existing (identical in onboarding/plan.tsx, profile.tsx)

## Change Log

- 2026-07-30: Implemented Story 3.10 — member app Plan Details & Check-In History (FR-062). New History tab (`(tabs)/history/index.tsx`) shows a paginated, pull-to-refreshable Check-ins list (member-scoped via the existing `member_read_own_attendance_events` RLS policy) alongside a static Payments placeholder tab. New Plan Details modal route (`app/plan.tsx`) shows the member's current plan (type, price, duration, active-from/expiry dates, billing interval, status badge, access description) via the existing `gym_staff_read_own_subscriptions`/`gym_staff_read_own_plans` policies. Home screen's "View Plan" and recent-activity rows now navigate to these screens instead of being no-ops. Shared subscription-status badge constants extracted out of `(tabs)/index.tsx` into `constants/subscription-status.ts` for reuse. No schema/RLS/RPC changes — mobile-UI-only.
