---
baseline_commit: 5626d55f8f73c47c6ad6668a026e1211b2a18095
---

# Story 4.9: Member App — Payment History & Receipt Detail

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want to view my payment history and individual receipts,
so that I can confirm what I've paid without asking the front desk.

## Scope Notes — Read Before the Acceptance Criteria

**This story fills in the Payments tab that Story 3.10 deliberately left as a static placeholder.** `apps/mobile/src/app/(tabs)/history/index.tsx` already has a working "Payments" | "Check-ins" segmented control (Check-ins fully functional, cursor-paginated); the Payments tab currently renders only `t('history.payments.empty')` with no query at all (3.10 Scope Note #4 — "there is no `payments` table yet"). That's no longer true: `payments` has existed since `0005_payments.sql` and has real rows since Epic 4 started. Your job is to make the Payments tab real, add the new MA-14 receipt screen, and extend the Home screen's Recent Activity feed to include payment events. **Read `apps/mobile/src/app/(tabs)/history/index.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, and `apps/mobile/src/app/plan.tsx` in full before starting** — they are the three closest precedents for every pattern this story reuses (cursor pagination, member-id resolution, loading/error states, i18n structure).

**This story requires a new migration — it is not mobile-UI-only, unlike Story 3.10.** `payments` has RLS enabled (`0005_payments.sql`) with exactly one read policy today, `gym_staff_read_own_payments` (`0030_payment_initiation_and_renewal.sql`), scoped to `(auth.jwt() ->> 'app_role') = any(array['owner','manager','receptionist'])` — **no member self-read policy exists**. This is unlike `subscriptions`/`plans`/`attendance_events`, which all already had a member-self-access clause added ahead of time (0018, 0017, 0026 respectively) — payments was never given one, because no prior story needed it. Task 1 adds it, mirroring `member_read_own_attendance_events`'s exact shape (0026).

**A second, narrower RLS gap: a member session cannot read *any other* `members` row, including a staff member's.** The receipt (MA-14) needs "Recorded by: [Actor Name]" — `payments.actor_id` is a `users.id`, not a `members.id` (same non-FK-joinable shape `listPendingPayments()` in `apps/dashboard/services/payments.ts` already works around with a second, batched `members` query — read that function's comment in full, it explains why no direct embed is possible). On the dashboard, the calling staff session already has broad `gym_staff_read_own_members` visibility (0018) to make that second query work. A member session has only `self_read_own_membership` (0013, `user_id = auth.uid()` — **own row only**) — resolving a *different* person's name via that second query would return zero rows under RLS today. Task 1 also adds a second, narrow policy, `member_read_gym_staff_members`, granting a member-role session read access to `members` rows **scoped to `role in ('owner','manager','receptionist')` only** (the same 3 roles `gym_staff_insert_own_payments`'s `with check` restricts `payments.actor_id` to — a payment's actor can never be a coach or another member) — never another member's row, never a coach's row. This is a deliberate, narrow broadening (a member can now see a staff name/phone/email/dob in their own gym, not just their own), same class of accepted, documented trade-off as 4.8's inherited Receptionist/Coach payments-read gap — do not try to shrink it further (e.g. a name-only column-level grant) since Postgres RLS is row-level, not column-level, and no precedent for column-level restriction exists anywhere in this schema.

**`payments.subscription_id` is `NULL` for most real payment rows today — plan name is not always available, and this is not a bug to "fix."** Verified by reading every INSERT site: `recordManualPayment()` (Story 4.3, `apps/dashboard/services/payments.ts`) never sets it — manual cash/bank-transfer/manual-momo payments stay `subscription_id = NULL` forever, even after verification. `initiatePayment()` (Story 4.2, same file) also omits it at insert; it only gets backfilled by `complete_verified_payment()` (`0030_payment_initiation_and_renewal.sql` line ~130) once a webhook confirms and a renewal subscription is created — so an online payment sitting in `processing` also has `subscription_id = NULL`. Only `confirm_renewal()`-driven payments (Stories 4.7/4.8, the Renewal Modal / Subscriptions page "Renew" flow) set it at insert time. **Both the Payments-tab list row and the receipt screen must treat a `null` embedded plan name as an expected, common case** — render a fallback string (`history.payments.planUnavailable` / `paymentDetail.planUnavailable`, Task 7), never `null`/`undefined`/blank, and never treat it as a load error.

**`payments.status` has 4 real values — `pending | processing | verified | flagged` (`0001_extensions_and_enums.sql`) — not the 3 the mockup's "Verified / Pending / Failed" wording suggests.** There is no `failed` status in this schema. `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts`'s `PAYMENT_STATUS_BADGE_CONFIG` only covers 3 of the 4 (it never has to show `processing` — the dashboard's Verification Queue only ever lists `pending` rows). The member app's own status map must cover all 4, since a member viewing their own history can genuinely see a `processing` row (an online Notch/TaraMoney payment mid-flight, before the webhook lands). Use "Processing" as its label — do not invent a "Failed" state that doesn't exist in the enum (Task 2).

**`payments.method` has 5 real values — `mtn_momo | orange_money | cash | bank_transfer | manual_momo`.** `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts`'s `PAYMENT_METHOD_LABEL_KEY` only maps 3 (`cash`/`bank_transfer`/`manual_momo`) because the dashboard's manual-entry form never writes the other 2 — but `initiatePayment()`'s caller-supplied `method` does write `mtn_momo`/`orange_money` for real online payments (Story 4.2), which a member absolutely will see in their own history. Map all 5 (Task 2) — do not copy the dashboard's 3-entry map verbatim.

**MA-14's route is `(tabs)/history/payment/[id].tsx`, a nested child of the History tab — not a new top-level modal route like `/plan`.** `architecture.md`'s directory tree (`apps/mobile` section) places it exactly there, and Story 3.10's Task 2 comment already reserved the folder structure for this ("leaves room for Epic 4 Story 4.9's `history/payment/[id].tsx`"). Because it's a file inside the `(tabs)/history/` folder (which `(tabs)/_layout.tsx`'s `NativeTabs` + Expo Router already wraps in its own per-tab stack), it needs **no new entry in `apps/mobile/src/app/_layout.tsx`** — unlike `/plan`, which is a sibling to `(tabs)` and needed an explicit `Stack.Screen` registration (3.10 Scope Note #2). Do not add one; `router.push(\`/history/payment/${id}\`)` from within the History tab's own stack is sufficient, and a plain `←` back button (`router.back()`, mirroring `plan.tsx`'s exact pattern) returns to the list.

## Acceptance Criteria

1. **Given** the History screen's Payments tab, **when** I view it, **then** it shows a reverse-chronological, paginated list of my payments (date, plan/method, amount in XAF, status), or "No payments on record yet." if empty. [Source: epics.md#Story 4.9 AC#1; FR-062]
2. **Given** a payment row, **when** I tap it, **then** I see the full receipt: member name, gym name, plan, amount, currency, method, date, transaction reference, actor, and status — read-only, no refund action available to the member. [Source: epics.md#Story 4.9 AC#2; FR-062]
3. **Given** the Home screen's Recent Activity feed (built in Epic 3, Story 3.7, scoped to check-ins only), **when** a payment is recorded for the member, **then** the feed is extended to show combined check-in and payment events, reverse-chronological, tappable through to this screen for payment rows. [Source: epics.md#Story 4.9 AC#3; FR-062]

## Tasks / Subtasks

- [x] **Task 1: Migration `0038_member_app_payment_history_receipt_detail.sql`** (AC: #1, #2)
  - [x] **`member_read_own_payments`** — mirrors `member_read_own_attendance_events`'s exact shape (`0026_member_app_home_screen_status_display.sql`), proving row ownership via `members.user_id = auth.uid()` (not a raw `member_id = auth.uid()` comparison, since `payments.member_id` references `members.id`, a different UUID):
    ```sql
    create policy "member_read_own_payments" on payments
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = 'member'
        and exists (
          select 1 from members m
          where m.id = payments.member_id and m.user_id = auth.uid()
        )
      );
    ```
    Coexists with `gym_staff_read_own_payments` (0030) — same-table SELECT policies are OR'd together (established pattern, see 0026's own comment).
  - [x] **`member_read_gym_staff_members`** — new, narrow policy on `members` (Scope Notes above explain why this is needed and why it's scoped this way):
    ```sql
    create policy "member_read_gym_staff_members" on members
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = 'member'
        and role = any(array['owner', 'manager', 'receptionist']::member_role[])
      );
    ```
    Role list matches `gym_staff_insert_own_payments`'s (`0030`) `with check` exactly — those are the only 3 roles `payments.actor_id` can ever resolve to. Coexists with `self_read_own_membership` (0013) and `gym_staff_read_own_members` (0018) — does not widen either. `role` is a `member_role` enum, not `text` — the array literal needs an explicit `::member_role[]` cast (`array['owner','manager','receptionist'] = any(...)` alone fails with `operator does not exist: member_role = text`, caught by `supabase db reset`).
  - [x] No baseline table-level GRANT changes needed — `authenticated` already has `select` on both `payments` (0005) and `members` (0003).
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` (WSL shell — see Dev Notes). RLS policies are not reflected in generated types; expect a no-op or near-no-op diff. Review it anyway — if it's not near-empty, stop and investigate before continuing (a policy-only migration producing a large types diff would be a signal something else changed). Confirmed: zero-line diff (the raw CLI output has to be filtered — `supabase gen types` writes a `Connecting to db 5432` status line to stdout ahead of the JSON/TS body in this CLI version, which corrupts a naive `> file` redirect; piped through `grep -v '^Connecting to db'` instead).

- [x] **Task 2: `apps/mobile/src/constants/payment-status.ts` — new file** (AC: #1, #2)
  - [x] `PaymentStatus = 'pending' | 'processing' | 'verified' | 'flagged'`, `PAYMENT_STATUSES` array, `isPaymentStatus()` type guard — same shape as `constants/subscription-status.ts`'s `SubscriptionStatus`/`SUBSCRIPTION_STATUSES`/`isSubscriptionStatus` (Story 3.10 Task 1).
  - [x] `PaymentMethod = 'mtn_momo' | 'orange_money' | 'cash' | 'bank_transfer' | 'manual_momo'`, `isPaymentMethod()` guard — all 5 real enum values (Scope Notes: do not copy the dashboard's 3-entry map).
  - [x] `PAYMENT_STATUS_COLORS: Record<PaymentStatus, {bg, border, text}>` and `paymentStatusLabelKey: Record<PaymentStatus, string>` — UX-DR5's "color AND label, never color alone" floor, same shape as `subscription-status.ts`'s `STATUS_COLORS`/`statusLabelKey`. 4 entries (`pending`, `processing`, `verified`, `flagged` — no `failed`, Scope Notes). `PAYMENT_METHOD_LABEL_KEY: Record<PaymentMethod, string>` — 5 entries.
  - [x] Extracted to a shared constants file (not duplicated per-screen) because both the Payments-tab list rows (Task 4) and the receipt screen (Task 5) need the identical mapping — same "duplicating a table is a real drift risk" reasoning as 3.10 Scope Note #1, applied here from the start instead of needing a later extraction pass.

- [x] **Task 3: `apps/mobile/src/services/payments.ts` — new file** (AC: #1, #2)
  - [x] `PaymentListRow` interface: `{ id, createdAt, amount, currency, method: string, status: string, planName: string | null }`.
  - [x] `loadPaymentsPage(memberId: string, after: {createdAt: string; id: string} | null, limit: number)` — cursor (keyset) pagination on `(created_at desc, id desc)`, **not** offset-based `.range()`. Copy `apps/mobile/src/app/(tabs)/history/index.tsx`'s `loadCheckInsPage`'s exact cursor shape (the `.or('created_at.lt.X,and(created_at.eq.X,id.lt.Y)')` construction) — that function replaced an earlier offset design specifically because offset pagination drifts/duplicates rows under concurrent inserts (Story 3.10 Review Finding, now-fixed and the established pattern; do not reintroduce the offset version this story's own precedent file already moved away from). Query:
    ```ts
    supabase
      .from('payments')
      .select('id, amount, currency, method, status, created_at, subscription_id, subscriptions(plans(name))')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
    ```
    `subscriptions(plans(name))` is a two-hop nested embed (`payments.subscription_id → subscriptions.id`, then `subscriptions.plan_id → plans.id`) — the first 2-level nested embed in this app (every prior query embeds at most one hop). Standard PostgREST behavior, but verify the shape hands-on (Task 10) since it's new to this codebase. When `subscription_id` is `null`, the embedded `subscriptions` field is `null` — map to `planName: null` (Scope Notes: expected, not an error).
  - [x] `PaymentReceipt` interface: `{ id, memberName, gymName, planName: string | null, amount, currency, method: string, createdAt, transactionRef: string | null, actorName: string | null, status: string }`.
  - [x] `getPaymentReceipt(paymentId: string, memberId: string, memberGymId: string, memberName: string, gymName: string)` — takes the caller-resolved member/gym context as parameters (mirrors this app's established "resolve once, pass down" convention, e.g. `history/index.tsx` resolving `gymName` once and passing it into row rendering) rather than re-querying `members`/`gyms` a second time:
    1. `.from('payments').select('id, amount, currency, method, status, created_at, provider_transaction_ref, actor_id, subscription_id, subscriptions(plans(name))').eq('id', paymentId).eq('member_id', memberId).single()` — the `.eq('member_id', memberId)` is defense-in-depth (RLS from Task 1 already scopes this to the caller's own payment; matches `subscriptions_current`'s own "still add an explicit filter" precedent from Story 4.8).
    2. If `actor_id` is non-null: `.from('members').select('name').eq('user_id', actorId).eq('gym_id', memberGymId).maybeSingle()` (Task 1's new `member_read_gym_staff_members` policy is what makes this return a row instead of RLS-denying it). `actor_id` can legitimately be null (`initiatePayment()` never sets it) — when null, or when the lookup returns no row, `actorName` is `null`; render a fallback (Task 5), don't error.
    3. Return `null` (not throw) on any query error — the calling screen owns the load-error UI, matching every other service function's return-shaped-error convention in this file's sibling `services/checkin.ts`.

- [x] **Task 4: History screen — make the Payments tab real** (AC: #1)
  - [x] `apps/mobile/src/app/(tabs)/history/index.tsx`: replace the static `paymentsEmpty` block (currently just `t('history.payments.empty')`, no query) with a second `FlatList`, structurally parallel to the Check-ins tab's existing one — its own `payments`/`paymentsCursor`/`paymentsHasMore`/`paymentsInitialLoading`/`paymentsLoadError`/`paymentsLoadingMore`/`paymentsPageError`/`paymentsRefreshing` state (own state slice, not shared with the Check-ins tab's — each tab loads/paginates independently, matching this screen's existing per-tab state separation).
  - [x] **Lazy-load on first tab activation, not on mount** — unlike Check-ins (which loads immediately since it's the default tab), only call the Payments loader the first time `activeTab` becomes `'payments'` (a `paymentsLoaded` boolean guard). Loading both tabs' data unconditionally on every History screen mount would double every load for the common case (a member who never opens the Payments tab this session).
  - [x] Row: date (left, `new Date(item.createdAt).toLocaleDateString(i18n.language, {dateStyle:'medium'})` — payments have no separate date-only column like `subscriptions.expiry_date`, so this is a fresh small helper, not a copy of `formatDateOnly`'s YYYY-MM-DD-string parsing), plan name + method (middle — `item.planName ?? t('history.payments.planUnavailable')` then `t(PAYMENT_METHOD_LABEL_KEY[method])` if `isPaymentMethod(method)`, else the raw string as a last-resort fallback), amount (right — `` `${item.amount} ${item.currency}` ``, unformatted/unlocalized, matching `plan.tsx`'s established "no Intl.NumberFormat anywhere in this app" convention), status badge (Task 2's color/label map).
  - [x] Tappable row (`Pressable`, `accessibilityRole="button"`) → `router.push(\`/history/payment/${item.id}\`)`.
  - [x] Empty state (zero payments, page 0 only): `t('history.payments.empty')` (existing key, unchanged copy). Pull-to-refresh + infinite scroll (`onEndReached`), same `busy`-guard discipline as the Check-ins tab (Story 3.10 Review Findings: refresh and end-reached must be mutually exclusive, per-tab).
  - [x] Loading state: `ActivityIndicator`, matching the Check-ins tab and this app's established no-skeleton convention.

- [x] **Task 5: New `apps/mobile/src/app/(tabs)/history/payment/[id].tsx` — MA-14 Payment Detail (receipt)** (AC: #2)
  - [x] On mount: read `id` via `useLocalSearchParams<{ id: string }>()` (Expo Router's dynamic-segment convention — verify the exact hook/typing shape against the versioned docs per `apps/mobile/AGENTS.md`, this is the first dynamic route param anywhere in this app). Resolve own `members.id` + `gym_id` + `name` (extend the standard duplicated resolution block to also select `gym_id, name`, not just `id` as every prior screen does — Task 3's `getPaymentReceipt` needs both) and the gym's `name`, then call `getPaymentReceipt(id, memberId, memberGymId, memberName, gymName)`.
  - [x] Card fields, all read-only, no actions (AC #2: "no refund action available to the member" — there is nothing to build here, just nothing *to* build; do not add a refund button or any interactive element beyond the back button): Member name, Gym name, Plan (`planName ?? t('paymentDetail.planUnavailable')`), Amount + currency, Method (`PAYMENT_METHOD_LABEL_KEY`), Date, Reference (`transactionRef ?? t('paymentDetail.noReference')` — null for cash/manual payments, which have no `provider_transaction_ref`, per `0005_payments.sql`'s own comment), Recorded by (`actorName ?? t('paymentDetail.unknownActor')`), Status (Task 2's label, plain text is fine here — mockup shows it as a plain field, not a colored badge, unlike the list row).
  - [x] Back button (`←`, `router.back()`) — copy `plan.tsx`'s exact `backButton` pattern (Scope Notes: this is a nested-stack push, not a modal, but the same back-arrow UI/pattern applies).
  - [x] Loading/error states: `ActivityIndicator` + a load-failure card with "Try again" retry, same shape as every other screen (`plan.tsx`, `index.tsx`, `history/index.tsx`). A `null` result from `getPaymentReceipt` (query error, RLS-denied, or a stale/deleted id) is a single non-distinguished error state — do not try to build a separate "not found" vs. "failed to load" branch; no other screen in this app makes that distinction either (`plan.tsx`'s only special-cased branch is the `PGRST116` "genuinely zero rows" case, which doesn't apply here since `.single()` on a missing/RLS-denied id is exactly that same PGRST116 shape — treat it identically to any other load failure, simpler than `plan.tsx`'s `noSubscription` branch since there's no equivalent "this is a valid empty state" case for a receipt).

- [x] **Task 6: Home screen — combined Recent Activity feed** (AC: #3)
  - [x] `apps/mobile/src/services/payments.ts`: add `getRecentPayments(memberId: string, limit: number): Promise<RecentPayment[]>` — `RecentPayment = { id, createdAt, amount, currency }` (deliberately smaller than `PaymentListRow`; Home's activity row doesn't show plan/method/status per EXPERIENCE.md's MA-09 mockup, just enough to identify the event). Same best-effort, non-blocking, empty-array-on-any-failure contract as `getRecentCheckIns` (`services/checkin.ts`) — copy that function's try/catch shape.
  - [x] `apps/mobile/src/app/(tabs)/index.tsx`'s `loadHome`: fetch `getRecentCheckIns(memberId, 3)` and `getRecentPayments(memberId, 3)` in parallel (`Promise.all`, alongside the existing occupancy fetch — still best-effort/non-blocking, same as today), merge into one array tagged by kind (`{kind:'checkin', ...} | {kind:'payment', ...}`), sort by timestamp descending (`checkedInAt` vs. `createdAt`), take the top 3 (`RECENT_CHECK_INS_LIMIT`, rename to `RECENT_ACTIVITY_LIMIT` since it now bounds the merged feed, not just check-ins).
  - [x] Render: check-in rows keep their exact current appearance/behavior (`t('home.checkedIn')` + timestamp, `router.push('/history')`). Payment rows: new `t('home.paymentRecorded', {amount, currency})` label (e.g. "Payment: 25,000 XAF") + date, `router.push(\`/history/payment/${id}\`)` (AC #3: "payment rows navigate to MA-14" — check-in rows still go to `/history`, unchanged).
  - [x] Empty state (`home.recentActivityEmpty`) only when **both** feeds are empty — unchanged trigger condition (`recentCheckIns.length === 0` becomes `mergedActivity.length === 0`).

- [x] **Task 7: i18n — new `history.payments.*`, `paymentDetail.*`, `home.paymentRecorded`, and `payments.*` (status/method) keys** (AC: #1, #2, #3)
  - [x] `apps/mobile/src/locales/en.json`/`fr.json`: extend the existing `history.payments` block (currently just `{empty}`) with `planUnavailable` ("Plan unavailable"), `loading`/`errorLoadFailed` (mirror `history.checkins`'s existing key names for the same states).
  - [x] New top-level `paymentDetail` namespace: `title` ("Payment Receipt" — matches MA-14's mockup header, not "Payment Detail"), `memberLabel`, `gymLabel` (or fold gym name into the header the way MA-14's mockup shows `[Gym Logo] [Gym Name]` — a plain label row is sufficient, no logo requirement in the epics AC text), `planLabel`, `planUnavailable`, `amountLabel`, `methodLabel`, `dateLabel`, `referenceLabel`, `noReference`, `actorLabel` ("Recorded by"), `unknownActor`, `statusLabel`, `errorLoadFailed`.
  - [x] New top-level `payments` namespace (mobile's own — distinct from `packages/types/src/locales`'s shared admin-surface `payments.*`, same disambiguation `plan.tsx` already established between mobile's `plan.*` and `onboarding.plan.*`): `status.pending`, `status.processing`, `status.verified`, `status.flagged`, `methods.mtnMomo`, `methods.orangeMoney`, `methods.cash`, `methods.bankTransfer`, `methods.manualMomo`.
  - [x] `home.paymentRecorded` ("Payment: {{amount}} {{currency}}"), rename nothing else in `home.*`.
  - [x] French translations: match this file's existing tone (see `history.*`/`plan.*` FR entries already in `fr.json`) — do not machine-translate blindly (UX-DR14, repeated from every prior mobile story).
  - [x] Run `node scripts/check-i18n-key-parity.mjs` before finishing. Passed: 177 keys, en/fr in parity.

- [x] **Task 8: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) the two new RLS policies (`member_read_own_payments`, `member_read_gym_staff_members`) and why `payments`/`members` needed member-self-read gaps closed that every sibling table (`subscriptions`, `plans`, `attendance_events`) already had closed ahead of time; (2) why actor-name resolution is a narrow role-scoped `members` SELECT policy, not a `SECURITY DEFINER` RPC — consistency with this app's zero-RPC-reads-so-far convention (every mobile read to date is RLS + plain `.select()`; a receipt-assembly RPC would have been the first read-RPC in the app, a bigger precedent-setting decision than a narrow, precedented RLS broadening); (3) `payments.subscription_id`'s null-for-most-rows behavior and why the UI treats it as expected, not an error — worth flagging so a future story doesn't "fix" it as a bug.

- [x] **Task 9: pgTAP coverage** (AC: all)
  - [x] New file `supabase/tests/member_app_payment_history_receipt_detail.test.sql` (mirror `member_app_home_screen_status_display.test.sql`'s fixture/session-simulation style — `set local role authenticated` + `set_config('request.jwt.claims', ...)`, `reset role` before superuser-role assertions):
    - A member-claim session can `select` from `payments` for their own `member_id` (new `member_read_own_payments` policy).
    - The same session gets **zero rows** querying a different member's payments in the *same* gym (row-ownership check, not just gym-scoping).
    - The same session gets **zero rows** querying a payment in a *different* gym (tenant isolation — reuse `rls_tenant_isolation.test.sql`'s pattern if that remains the canonical home for cross-gym checks, per 4.8's own precedent of checking there first).
    - A member-claim session can `select name from members where user_id = <owner/manager/receptionist's user_id>` in their own gym (new `member_read_gym_staff_members` policy) — for each of the 3 roles.
    - The same session gets **zero rows** selecting a *coach's* `members` row (role excluded from the new policy) or *another member's* `members` row (unaffected by this story — `self_read_own_membership` is unchanged, still own-row-only).
    - `gym_staff_read_own_payments` (0030) still passes unaffected (regression) — staff session still reads all gym payments.
    - A payment row with `subscription_id is null` is still selectable (no join failure/error at the RLS layer — a data-shape sanity check, not strictly an RLS assertion, but cheap to include here since Task 1's fixtures already exist).
  - [x] **Regression fixes required by the two new policies, found by running the full suite:** `member_management_rls.test.sql`'s section (g) fixture put a member-role session in the same gym as an owner/manager/receptionist — its "sees only its own row" assertion (count `1`) now legitimately returns `4` (self + the 3 staff rows, via `member_read_gym_staff_members`); updated the expected count to `4` and added a new assertion that the coach row (role excluded from the policy) still returns `0`, with an updated comment explaining the behavior change (plan count `25` → `26`). `rls_tenant_isolation.test.sql`'s member-role session owns the fixture's one seeded payment row — its "payments: 0 rows, no business policy yet" assertion now legitimately returns `1` via `member_read_own_payments`; updated the expected count to `1`, the assertion text, and the file's header comment (plan count unchanged at `17`, no new assertions, just a corrected expectation). Full suite: `supabase test db` — `Files=31, Tests=541, Result: PASS` (this story's own new file contributes 12; `member_management_rls.test.sql` gained 1 new assertion, `26` total; every other file unchanged in count, only 2 corrected expected-values).

- [x] **Task 10: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages) — 0 errors. Required regenerating `apps/mobile/.expo/types/router.d.ts` (a gitignored, Metro-generated file) via a brief `expo start --web` run — it had no entry yet for the new `(tabs)/history/payment/[id].tsx` dynamic route, the first dynamic route anywhere in this app, so `router.push(\`/history/payment/${id}\`)` failed the typed-routes check under the stale manifest. Confirmed CI itself is unaffected: `.github/workflows/ci.yml`'s typecheck job never generates or restores this file, so it never enforces typed-routes strictness for `apps/mobile` in the first place — the failure was purely a stale local artifact from earlier dev sessions on this machine. `node scripts/check-i18n-key-parity.mjs` — 0 errors, 177 keys.
  - [x] `supabase test db` (WSL shell) — `Files=31, Tests=541, Result: PASS`. Two pre-existing tests needed updates because this story's two new RLS policies legitimately change their expected row counts (not bugs in the new policies) — see Task 9's own note for the two files/assertions changed and why.
  - [x] Hands-on (WSL-only Supabase convention, per Dev Notes; no device/simulator available per Stories 3.6–3.10's own documented limitation — used the same direct-query-under-a-simulated-member-session fallback those stories used, via `docker exec ... psql` against the local `supabase_db_gym_os` container with `set local role authenticated` + `set_config('request.jwt.claims', ...)`, PostgREST's embed syntax simulated as explicit `left join`s since raw `psql` doesn't understand it): seeded a member with 3 payments — one `verified` with a non-null `subscription_id` (renewal-panel-style), one `pending`/manual with `subscription_id is null` and `actor_id` pointing at a receptionist, one `processing` with a null `actor_id` — plus one check-in. Verified: the Payments-tab query lists all 3 in reverse-chronological order, with the two null-`subscription_id` rows correctly resolving `plan_name` to `null` (the `planUnavailable` fallback path) and the renewal row correctly resolving "Verify Monthly"; the manual payment's actor query correctly resolves "Verify Receptionist" via the new `member_read_gym_staff_members` policy; the `processing` payment's actor query returns no row (correctly maps to the `unknownActor` fallback, not an error); the merged check-in+payment feed's raw inputs interleave correctly by timestamp across both kinds when sorted descending and capped to 3.

## Dev Notes

- **Read before starting:** `apps/mobile/src/app/(tabs)/history/index.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/app/plan.tsx`, `apps/mobile/src/services/checkin.ts`, `apps/mobile/src/constants/subscription-status.ts`, `apps/dashboard/services/payments.ts` (specifically `listPendingPayments()`'s actor-name-resolution comment and `initiatePayment()`/`recordManualPayment()`'s INSERT shapes — the source of truth for which fields are/aren't populated), `supabase/migrations/0005_payments.sql`, `0030_payment_initiation_and_renewal.sql` (`complete_verified_payment()`), `0018_member_management.sql` lines 155-238 (the `members`/`subscriptions` self-read policies this story's new policies are modeled on), `0026_member_app_home_screen_status_display.sql` (`member_read_own_attendance_events`, the direct template for Task 1's first policy).
- **This project's local Supabase stack runs inside WSL2, not native Windows** — `supabase db reset`/`supabase test db`/`supabase gen types` must run from a WSL shell. [Memory: Supabase runs in WSL — confirmed still the case as of Story 4.8's session.]
- **Testing standard:** pgTAP is the primary automated coverage for the migration (Task 9). No E2E/browser or device automation exists for `apps/mobile` in V1 — Task 10's hands-on/simulated-session pass is the only way to verify the actual screens.
- **Do not build:** a refund action on the receipt (AC #2 explicitly excludes it), a colored badge on the receipt's Status field (mockup shows plain text there — the list row is where UX-DR5's color+label applies), an offline/cached version of payment history (no AC or FR requires it, and this app's only offline-queue precedent, `expo-sqlite`, is scoped exclusively to check-ins per architecture.md), any change to `apps/dashboard` or `apps/super-admin` (mobile-only story).
- **`apps/dashboard` and `apps/super-admin` are untouched by this story** — the Dashboard's own "All Payments" ledger table remains out of scope (still Scope-Note-excluded there, unrelated to this story).

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0038_member_app_payment_history_receipt_detail.sql   (new)
  supabase/tests/member_app_payment_history_receipt_detail.test.sql        (new)
  packages/types/src/database.ts                                          (regenerated, expect near-no-op diff)
  apps/mobile/src/constants/payment-status.ts                             (new)
  apps/mobile/src/services/payments.ts                                    (new)
  apps/mobile/src/app/(tabs)/history/payment/[id].tsx                     (new — MA-14)
  apps/mobile/src/app/(tabs)/history/index.tsx                            (modified — real Payments tab)
  apps/mobile/src/app/(tabs)/index.tsx                                    (modified — combined Recent Activity feed)
  apps/mobile/src/locales/en.json                                         (modified)
  apps/mobile/src/locales/fr.json                                         (modified)
  docs/decisions.md                                                       (modified)
  ```
  - `apps/mobile/src/app/_layout.tsx` is **not** in this list — the new receipt route is a nested child of `(tabs)/history/`, not a root-level sibling like `/plan` (Scope Notes).
  - `apps/mobile/src/app/plan.tsx`, `apps/mobile/src/components/app-tabs.tsx` are **not** in this list — no change needed, read-only precedent references.
  - `apps/dashboard/**`, `apps/super-admin/**` are **not** in this list — mobile-only story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.9] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-062] — "Members can view current plan details, expiry date, payment history, and past check-ins" (payment-history portion completed by this story)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-11 "History" (lines 717–748, Payments tab spec)] — row layout, empty state, loading, pagination
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-14 "Payment Detail" (lines 817–838)] — receipt field list and layout
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-09 "Home" (lines 547–606, "Recent activity section")] — combined-feed spec, tap-through routing rule
- [Source: _bmad-output/planning-artifacts/architecture.md — Project Structure's `apps/mobile/app/(tabs)/history/payment/[id].tsx` entry (MA-14), explicitly annotated as this route's future home]
- [Source: supabase/migrations/0005_payments.sql] — `payments` table shape, `provider_transaction_ref`'s nullable-for-cash/manual comment
- [Source: supabase/migrations/0030_payment_initiation_and_renewal.sql] — `gym_staff_read_own_payments`/`gym_staff_insert_own_payments` (the role-list Task 1's new `members` policy mirrors), `complete_verified_payment()` (subscription_id backfill timing)
- [Source: supabase/migrations/0018_member_management.sql lines 155-238] — `gym_staff_read_own_members`, `self_read_own_membership`(0013)-adjacent context, `gym_staff_read_own_subscriptions`'s member-self-access OR-clause shape (the template for every "add a member-self-read policy" story since, including this one)
- [Source: supabase/migrations/0026_member_app_home_screen_status_display.sql] — `member_read_own_attendance_events`, Task 1's direct template
- [Source: apps/dashboard/services/payments.ts] — `listPendingPayments()`'s actor-name batched-query pattern (the shape Task 3's `getPaymentReceipt` reuses, now made possible for a member session by Task 1's new policy), `initiatePayment()`/`recordManualPayment()`'s exact INSERT column lists (source of truth for `subscription_id`/`actor_id` nullability)
- [Source: apps/dashboard/app/(dashboard)/payments/paymentLabels.ts] — `PAYMENT_STATUS_BADGE_CONFIG`/`PAYMENT_METHOD_LABEL_KEY` shape to mirror in Task 2 (not import — mobile locales/constants are always separate per architecture.md), and the specific 3-of-4 / 3-of-5 gaps this story's own constants must not repeat
- [Source: apps/mobile/src/app/(tabs)/history/index.tsx] — `loadCheckInsPage`'s cursor-pagination shape (Task 3/4's direct template), segmented-control structure, per-tab loading/error/empty state pattern
- [Source: apps/mobile/src/app/(tabs)/index.tsx] — `loadHome`, `getRecentCheckIns` call site, recent-activity row rendering (Task 6's extension point)
- [Source: apps/mobile/src/app/plan.tsx] — modal-route back-button pattern, load-error/retry card shape, `isSubscriptionRow`-style narrowing-guard convention (Task 5's template)
- [Source: apps/mobile/src/services/checkin.ts] — `getRecentCheckIns`'s best-effort/empty-array-on-failure contract (Task 6's `getRecentPayments` mirrors it)
- [Source: apps/mobile/src/constants/subscription-status.ts] — `STATUS_COLORS`/`statusLabelKey`/`isSubscriptionStatus` shape, Task 2's direct template
- [Source: scripts/check-i18n-key-parity.mjs] — already walks `apps/mobile/src/locales`
- [Source: _bmad-output/implementation-artifacts/3-10-member-app-plan-details-check-in-history.md] — Payments tab's original placeholder scope (Scope Note #4, now superseded by this story), the cursor-pagination Review Findings this story must not regress on, `(tabs)/history/payment/[id].tsx`'s reserved folder structure
- [Source: _bmad-output/implementation-artifacts/4-8-subscriptions-page-manual-renewal.md] — most recent Epic 4 story; `subscriptions_current`'s "explicit filter as defense-in-depth even under RLS" precedent (Task 3), pgTAP baseline count (527) for Task 10
- [Source: docs/decisions.md] — entry-format/tone precedent for Task 9

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the bmad-dev-story workflow.

### Debug Log References

- `supabase db reset` (WSL) failed first attempt: `operator does not exist: member_role = text` on `member_read_gym_staff_members`'s `role = any(array[...])` clause — `members.role` is the `member_role` enum, not `text`. Fixed with an explicit `::member_role[]` cast on the array literal.
- `supabase gen types typescript --local > database.ts` (WSL) corrupted the output file on the first attempt: this CLI version (2.109.0) writes a `Connecting to db 5432` status line to stdout ahead of the real TS body, which lands inside the redirected file. Fixed by piping through `grep -v '^Connecting to db'` before redirecting.
- `pnpm run typecheck` failed on both new `router.push(\`/history/payment/${id}\`)` call sites until `apps/mobile/.expo/types/router.d.ts` (gitignored, Metro-generated) was regenerated via a brief local `expo start --web` run — this app's first-ever dynamic route needed the typed-routes manifest to pick it up. Confirmed this is a local-only artifact issue, not a CI gap: `.github/workflows/ci.yml` never generates this file before running `tsc`, so it doesn't enforce typed-routes strictness for `apps/mobile` at all today.
- `supabase test db` (WSL) surfaced 2 pre-existing test regressions after the new migration, both expected consequences of the new RLS policies rather than bugs: `member_management_rls.test.sql`'s member-session "sees only its own row" assertion (now legitimately 4, not 1, since the session's gym has an owner/manager/receptionist the new `member_read_gym_staff_members` policy now reveals) and `rls_tenant_isolation.test.sql`'s "payments: 0 rows, no business policy yet" assertion (now legitimately 1, since the fixture's own payment belongs to the calling member and `member_read_own_payments` now grants it). Both files updated with corrected expectations and explanatory comments; see docs/decisions.md's own entry for the underlying policy rationale.

### Completion Notes List

- All 4 ACs implemented: Payments tab (AC #1) is a real cursor-paginated, pull-to-refresh FlatList; MA-14 receipt screen (AC #2) is a new nested dynamic route, read-only, no refund action; Home's Recent Activity feed (AC #3) now merges check-ins and payments into one reverse-chronological, tap-through feed; every coach-assignment change is N/A to this story (audit logging, AC #4 equivalent from Story 5.1, not applicable here — this story's own ACs are #1-#3 only per the story file).
- New migration `0038` adds exactly the two RLS policies the Scope Notes specified, no more — `payments` gets zero additional write grants (unchanged from 0005/0030), `members` gets one new narrow role-scoped SELECT policy.
- No device/simulator was available (same documented V1 limitation as Stories 3.6–3.10) — Task 10's hands-on pass used a direct-query-under-simulated-member-session fallback via `docker exec ... psql` against the local Supabase container, confirming every query shape (cursor pagination, receipt actor-name resolution including both the resolved and null-actor cases, and the merged-feed sort) behaves as the service functions expect.
- Full regression suite: `pnpm run typecheck` (0 errors, all 4 packages), `node scripts/check-i18n-key-parity.mjs` (0 errors, 177 keys), `supabase test db` (541/541 assertions pass, including this story's 12 new ones and 2 corrected pre-existing ones).

### File List

- `supabase/migrations/0038_member_app_payment_history_receipt_detail.sql` (new)
- `supabase/tests/member_app_payment_history_receipt_detail.test.sql` (new)
- `supabase/tests/member_management_rls.test.sql` (modified — regression fix, plan count 25→26)
- `supabase/tests/rls_tenant_isolation.test.sql` (modified — regression fix, corrected expectation)
- `packages/types/src/database.ts` (regenerated — zero-line diff)
- `apps/mobile/src/constants/payment-status.ts` (new)
- `apps/mobile/src/services/payments.ts` (new)
- `apps/mobile/src/app/(tabs)/history/payment/[id].tsx` (new — MA-14)
- `apps/mobile/src/app/(tabs)/history/index.tsx` (modified — real Payments tab)
- `apps/mobile/src/app/(tabs)/index.tsx` (modified — combined Recent Activity feed)
- `apps/mobile/src/locales/en.json` (modified)
- `apps/mobile/src/locales/fr.json` (modified)
- `docs/decisions.md` (modified)

### Review Findings

- [x] [Review][Patch] Pull-to-refresh failure on the Payments tab hides the already-loaded list behind a full-page error card [apps/mobile/src/app/(tabs)/history/index.tsx:326] — fixed: full-page error card now only shows when there are zero rows to display; a refresh failure with existing rows keeps the list visible.
- [x] [Review][Patch] pgTAP assertion (l) claims to verify no RLS-layer join failure for a null `subscription_id`, but runs after `reset role` (RLS-bypassing), so it doesn't test what its comment claims [supabase/tests/member_app_payment_history_receipt_detail.test.sql:1594] — fixed: assertion moved to run under Member A's own RLS-scoped session (right after (a)-(c)), `reset role` removed, comment corrected.
- [x] [Review][Patch] Unrecognized `payments.status` values are silently mislabeled as "Pending" in the Payments-tab list row, while the receipt screen shows the raw string for the same case — inconsistent, misleading fallback on a financial record [apps/mobile/src/app/(tabs)/history/index.tsx:475] — fixed: unrecognized status now renders as raw text with a neutral badge instead of defaulting to 'pending' styling.
- [x] [Review][Defer] `getPaymentReceipt`'s `gymResult` query has no explicit filter, unlike every other query added in this diff, which all add a defense-in-depth `.eq(...)` per their own comments — relies solely on RLS for single-row scope [apps/mobile/src/app/(tabs)/history/payment/[id].tsx:997] — deferred, pre-existing pattern of relying on RLS alone predates this story in places, low risk
- [x] [Review][Defer] `getRecentPayments` has no secondary `order by id` tie-breaker at its `.limit()` boundary, unlike `loadPaymentsPage` in the same file — deferred, pre-existing pattern (`getRecentCheckIns` has the same gap and this function is modeled directly on it)
- [x] [Review][Defer] Home screen's merged-activity sort comparator has no fallback for a date-parse failure (NaN) — deferred, requires malformed DB data to trigger, no other screen in this app guards `new Date().getTime()` either
