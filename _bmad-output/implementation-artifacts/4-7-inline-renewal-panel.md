---
baseline_commit: 9dc27bd8626132244febc7b2998529c662cdb5fc
---

# Story 4.7: Inline Renewal Panel

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Receptionist,
I want to renew a member's subscription directly from the front-desk alert,
so that I can collect payment in the same moment I catch them.

## Scope Notes — Read Before the Acceptance Criteria

**This story's only trigger is the front-desk alert's new `[Renew]` button.** All 3 literal ACs below start with "Given a front-desk alert." The UX mockup (EXPERIENCE.md line 1542) also lists the Subscriptions page row and the Overview "Expiring This Week" table as `InlineRenewalPanel` trigger points — **neither exists yet.** The Subscriptions page is Story 4.8 (unbuilt); Overview's stat cards/tables were explicitly deferred by Story 4.6's own Scope Notes as "unassigned to any current story" and remain unassigned. Build `InlineRenewalPanel` as a standalone, reusable component (UX-DR3 requires this — no per-trigger forks) so Story 4.8 can render it from a table row later, but **the only place it is actually wired up in this story is `FrontDeskAlertPanel`**. Do not build the Subscriptions page or Overview's stat cards/tables — out of scope.

**New atomic RPC function, not a reuse of `renew_subscription()` + `recordManualPayment()` as two separate calls — this is a deliberate design decision, not an oversight.** `packages/types/src/schemas/subscription.ts`'s own comment (written during Story 3.2) says "Epic 4 Stories 4.7/4.8 will import this schema directly" — read that as "reuse this schema's *shape*" (this story's schema `.extend()`s it), not "call `renew_subscription()` and `recordManualPayment()` back-to-back from the Server Action." Two separate RPC calls would create a real correctness gap: if the first call (payment) succeeds and the second (subscription reset) fails, or vice versa, a retry (which the UX spec explicitly requires — "panel stays open for retry" on failure) could create a second pending payment row or leave a paid member unrenewed, with no unique constraint anywhere to catch it (unlike the provider-webhook path, which has `provider_transaction_ref`). This story adds one new `SECURITY DEFINER` function, `confirm_renewal()`, that inserts the new `subscriptions` row and the new `payments` row in the same transaction, self-checking the caller's role exactly like `renew_subscription()` (0022) and `check_in()` already do — this is an established pattern in this codebase, not a new one.

**The renewal payment is inserted as `status = 'verified'` directly, bypassing the pending Verification Queue (Story 4.3) — also deliberate.** Every other manual payment in this codebase starts `pending` and needs a separate staff verification step (`gym_staff_verify_own_payments`, 0031) because it might have been recorded by one staff member and needs independent confirmation by another. A renewal-panel payment has no such gap: the same receptionist confirming the renewal is the one who just collected the cash in front of the member — there is no second person to verify it. `renew_subscription()`'s AC also requires "subscription resets to active" *immediately* on confirm, which would be incoherent if the backing payment could still be flagged/rejected later. `confirm_renewal()` inserts directly with `status = 'verified'`, using `payments.subscription_id` (existing, nullable FK — unused by every payment row written so far; see `architecture.md`'s Entity Relationships note "a renewal payment links to the subscription it renewed") to link the two new rows. This bypasses the `gym_staff_insert_own_payments` RLS policy's `status = any(array['pending','processing'])` `with check` — safe, because `SECURITY DEFINER` functions owned by the migration role bypass RLS entirely, exactly like `renew_subscription()` already bypasses `manager_or_owner_insert_own_subscriptions` to let a Receptionist call it.

**Plan is NOT switchable in this story — a deliberate scope cut from the UX mockup, matching `renew_subscription()`'s own explicit precedent.** EXPERIENCE.md's mockup shows an editable `Plan [Monthly ▾]` dropdown ("changing plan recalculates renewal price"). `0022_manual_renewal_reset.sql`'s own comment already made this exact call for `renew_subscription()`: "Reuses the same plan_id as the member's most recent prior subscription -- no plan-switching-at-renewal in this story (no AC asks for it; YAGNI)." None of this story's 3 literal ACs test plan-switching either. Render Plan as a **read-only** field showing the member's current plan name — not a `<select>`. Document this as a UX deviation in `docs/decisions.md` (Task 9), mirroring Story 4.6's own "documented deviation from the UX mockup" precedent for its `[Renew]` button cut.

**Start date is fixed to today, not editable, and not back-datable — the mockup's "New start date [04 Jul 2026] (editable)" field and its backdating rule are Story 4.8's job, not this one's.** This story's literal AC #1 says "today's date as the start date" (not "an editable date field"). Story 4.8's own AC explicitly frames back-dating as new functionality it adds: "with the option to back-date the renewal start to the member's original expiry date for grace/expired members" (FR-085). `confirm_renewal()` takes no date parameter — it always uses `current_date` server-side, exactly like `renew_subscription()` already does. Render the start date as a read-only "Today" display, not an input.

**No push notification (N-04) is sent.** AC #2's epics.md text says "the member receives push N-04" — Epic 6 (Push Notifications) is entirely `backlog` in `sprint-status.yaml`; no push infrastructure (`send_push_notification()`, Expo token registration) exists yet. Do not attempt to build any part of Epic 6 here. Document this gap explicitly in `docs/decisions.md` (Task 9) — it is the only literal AC clause this story cannot fulfill, and it is a pre-existing sequencing fact (Epic 6 is scheduled after Epic 4 in the epic list), not a defect introduced by this story.

**Dismissing the alert on a successful renewal reuses the exact same client-side path as the existing `[✕]` dismiss button — no new DB-side alert logic.** `confirm_renewal()` does not touch `front_desk_alerts` at all. `InlineRenewalPanel` receives the triggering `alertId` as a prop; on a successful `confirmRenewalAction` call, it calls the same `dismissFrontDeskAlert(alertId)` from `apps/dashboard/lib/realtime/frontDeskAlerts.ts` that `FrontDeskAlertPanel`'s dismiss button already calls (Story 4.6). That function's `.is("dismissed_at", null)` guard already makes a duplicate/racing dismiss a harmless no-op, so no new idempotency work is needed here.

## Acceptance Criteria

1. **Given** a front-desk alert, **when** I tap "Renew", **then** an inline panel opens pre-populated with the member's current plan, renewal price in XAF, and today's date as the start date — no navigation away. [Source: epics.md#Story 4.7 AC#1; UX-DR3]
2. **Given** the pre-populated panel with no changes needed, **when** I tap "Confirm Renewal", **then** the payment is recorded, the subscription resets to active, the alert dismisses, and — in 3 taps total for a straight-through cash renewal — the flow completes (push N-04 is out of scope; see Scope Notes). [Source: epics.md#Story 4.7 AC#2; FR-050, FR-032]
3. **Given** a renewal submission fails, **when** the error occurs, **then** an inline error is shown and the panel stays open for retry. [Source: epics.md#Story 4.7 AC#3]

## Tasks / Subtasks

- [x] **Task 1: Migration `0035_inline_renewal_panel.sql` — `confirm_renewal()` function** (AC: #1, #2, #3)
  - [x] Exact function, modeled directly on `renew_subscription()` (0022) with a payment insert folded in:
    ```sql
    create function confirm_renewal(
      p_member_id uuid,
      p_method payment_method,
      p_reason text,
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
    begin
      if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
        raise exception 'permission denied';
      end if;

      v_caller_gym_id := private.gym_id();
      if v_caller_gym_id is null then
        raise exception 'permission denied';
      end if;
      v_actor_id := auth.uid();

      select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
      from members where id = p_member_id and gym_id = v_caller_gym_id;

      if v_member_gym_id is null then
        raise exception 'confirm_renewal: member % not found', p_member_id;
      end if;

      if v_deactivated_at is not null then
        raise exception 'confirm_renewal: member % is deactivated and cannot be renewed', p_member_id;
      end if;

      if p_reason is null or btrim(p_reason) = '' then
        raise exception 'confirm_renewal: reason is required';
      end if;

      select s.plan_id into v_plan_id
      from subscriptions s
      where s.member_id = p_member_id
      order by s.created_at desc
      limit 1;

      if v_plan_id is null then
        raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
      end if;

      select duration_days, price, plans.currency into v_duration_days, amount, currency
      from plans where id = v_plan_id;

      new_expiry_date := case when v_duration_days is null then null else current_date + v_duration_days end;

      insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
      values (v_member_gym_id, p_member_id, v_plan_id, 'active', current_date, new_expiry_date)
      returning id into subscription_id;

      insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason)
      values (v_member_gym_id, p_member_id, subscription_id, amount, currency, p_method, 'verified', v_actor_id, p_reason)
      returning id into payment_id;

      perform log_audit_event(
        p_action_type => 'renewal_confirmed',
        p_gym_id => v_member_gym_id,
        p_target_entity_id => p_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object(
          'reason', p_reason,
          'method', p_method,
          'amount', amount,
          'currency', currency,
          'payment_id', payment_id,
          'subscription_id', subscription_id,
          'plan_id', v_plan_id,
          'new_expiry_date', new_expiry_date
        )
      );
    end;
    $$;

    revoke execute on function confirm_renewal from public;
    grant execute on function confirm_renewal to authenticated;
    ```
  - [x] Guard ordering copies `renew_subscription()` exactly (role check → tenant-scoped member lookup → deactivated guard → reason guard → plan lookup) — same tenant-isolation rationale (0022's own comment): a cross-gym `member_id` must fail identically to a nonexistent one.
  - [x] `out` parameters (not a separate composite type) — mirrors `check_in()`'s pattern of returning a row shape callers read via `supabase.rpc(...)`'s single-object response; simpler than defining a new composite type for one function.
  - [x] Do **not** touch `renew_subscription()`, `recordManualPayment()`, or any existing RLS policy — this migration only adds the one new function.
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local`; review the diff for only the expected new function signature (no unrelated churn).

- [x] **Task 2: Zod schema `confirmRenewalSchema`** (AC: #2, #3)
  - [x] Append to `packages/types/src/schemas/subscription.ts` (do not create a new file — this literally fulfills that file's own "Stories 4.7/4.8 will import this schema" comment):
    ```ts
    export const confirmRenewalSchema = renewSubscriptionSchema.extend({
      method: z.enum(["cash", "bank_transfer", "manual_momo"]),
    });

    export type ConfirmRenewalInput = z.infer<typeof confirmRenewalSchema>;
    ```
  - [x] Inherits `memberId`/`reason` (min 5, max 200 chars) verbatim from `renewSubscriptionSchema` — note this is a 5-char minimum, not the 10-char minimum `recordManualPaymentSchema` uses for its note field; this is an accepted inconsistency from extending the schema this story is explicitly told to reuse, not a bug to "fix" by diverging further. The UX's prefilled "Paid at desk" default (12 chars) satisfies either minimum.
  - [x] `method` is the same 3-value manual-methods enum as `recordManualPaymentSchema` (cash/bank_transfer/manual_momo) — the renewal panel never offers `mtn_momo`/`orange_money` (those are `initiatePayment`'s automated-only methods; no AC or UX text asks for an automated-payment path inside this panel).

- [x] **Task 3: `apps/dashboard/services/subscriptions.ts` — `confirmRenewal()` and `getRenewalPreview()`** (AC: #1, #2, #3)
  - [x] `confirmRenewal(input: ConfirmRenewalInput)`: validates via `confirmRenewalSchema`, calls `supabase.rpc('confirm_renewal', { p_member_id: ..., p_method: ..., p_reason: ... })`, maps the `{ data, error }` result the same way `renewSubscription` does. Returns `{ data: { paymentId, subscriptionId, amount, currency, newExpiryDate } | null, error }`.
  - [x] `getRenewalPreview(memberId: string)`: read-only, backs Task 6's panel pre-population (AC #1). Server-side read (this file already uses the server/cookie-based client) is fine even though the panel opens client-side — call it via a thin Server Action (Task 4), not a direct client Supabase query, to keep this story's one new read on the same server-client pattern this file already uses (unlike Story 4.6's alert-specific `lib/realtime/` reads, which had to be client-side because they're realtime/browser-native; this read has no such constraint). Query: same "most recent subscription → plan" pattern as `initiatePayment` (`payments.ts:79-86`) — `.from("subscriptions").select("plans(id, name, price, currency)").eq("gym_id", gymId).eq("member_id", memberId).order("created_at", { ascending: false }).limit(1).maybeSingle()`. Returns `{ data: { planName, price, currency } | null, error }`; a `null` plan (member has no subscription at all) maps to a `not_found` `AppError` — the panel shows this as its inline error state (Task 6), matching AC #3's "renewal submission fails" pattern even though this specific failure happens on open, not on confirm.

- [x] **Task 4: `apps/dashboard/app/(dashboard)/subscriptions/actions.ts` — new file** (AC: #1, #2, #3)
  - [x] This directory does not exist yet (`apps/dashboard/app/(dashboard)/subscriptions/` has no `page.tsx` — that's Story 4.8). Create only `actions.ts`, no `page.tsx`. `architecture.md`'s own directory listing already names `subscriptions/actions.ts # renewSubscription` as the intended home for renewal Server Actions — this precedent (backend/actions landing before the page that uses them) already exists twice in this codebase (`services/subscriptions.ts` since Story 3.2, `initiatePayment` since Story 4.2, both shipped with no dashboard UI at the time).
  - [x] `confirmRenewalAction(input: unknown)`: `"use server"`, validates via `confirmRenewalSchema.safeParse`, calls `confirmRenewal` (Task 3). Returns `{ data: {...} | null, error: AppError | null }` — same shape as every other action in this codebase. No separate audit-log call needed here (unlike `payments/actions.ts`'s two-step `recordPayment`/`logPaymentChange` pattern) — `confirm_renewal()` already writes its own audit record inside the same transaction (Task 1), matching `renew_subscription()`'s own self-auditing precedent, not the Payments flow's split pattern.
  - [x] `getRenewalPreviewAction(memberId: string)`: thin wrapper around `getRenewalPreview` (Task 3), same shape as `searchMembersForPaymentAction`.

- [x] **Task 5: `apps/dashboard/components/shared/InlineRenewalPanel.tsx` — new component** (AC: #1, #2, #3)
  - [x] Client component. This is the **first inline-expanding/drawer component in this codebase** — every existing modal (`RecordPaymentModal`, `RecordRefundModal`, `FlagPaymentDialog`) uses `<dialog>`. Do not reuse `<dialog>` here — UX explicitly requires "expands inline within or adjacent to the triggering alert/row. Does NOT navigate away" with no backdrop.
  - [x] Props: `{ alertId: string; memberId: string; memberName: string; onClose: () => void; onRenewed: () => void }`.
  - [x] On mount, calls `getRenewalPreviewAction(memberId)` (a `useEffect` + local state is fine here — this is a one-shot fetch on panel open, not a live-updating list; TanStack Query is this codebase's convention for shared/cached reads, but a single-fire preview fetch scoped to one open panel instance doesn't need a query-cache entry. If you prefer consistency with the rest of this app's client reads, wrapping it in `useQuery` is also acceptable — do not block on this choice).
  - [x] Layout matches the UX mockup exactly, with Plan/Price/Date rendered read-only (Scope Notes) and Method/Note editable:
    ```
    Renew Membership                                               [X]
    [Avatar 40px] {memberName}

    Plan            {planName}                    (read-only)
    New start date  Today                          (read-only)
    Renewal price   {currency} {price}              (read-only)
    Payment method  [Cash                    v]     (select: cash/bank_transfer/manual_momo)
    Note *          [Paid at desk                ]  (textarea, required, min 5 chars)

    [Cancel]                             [Confirm Renewal ->]
    ```
  - [x] Method defaults to `"cash"`; Note defaults to a translated `renewalPanel.notePrefillCash` string when method is `"cash"`, and clears to empty when the method changes away from cash (UX: "pre-filled 'Paid at desk' for Cash; cleared when method changes"). No `Input`/avatar component exists for a reusable avatar — reuse `FrontDeskAlertPanel`'s inline initials-fallback pattern (`memberName.slice(0,1).toUpperCase()` in a `size-10 rounded-full bg-muted` div) rather than building a new one; no member photo is threaded through as a prop (not needed for AC #1's literal text — "avatar" isn't in this story's own AC, only the UX mockup's decorative layout; keep the initials-only version unless you're already passing `memberPhotoUrl` through from `FrontDeskAlertPanel` for free).
  - [x] **Responsive presentation (UX-DR3):** default — renders inline (a block below/adjacent to the triggering alert row, pushing content down, no overlay). Tablet breakpoint (768–1023px, Tailwind's default `md` range is close but verify against this project's configured breakpoints in `tailwind.config.ts` before hardcoding) — renders as a fixed 320px right-side drawer instead (`fixed right-0 top-0 h-full w-[320px]`, no backdrop specified by UX). Implement via a CSS media-query class toggle (e.g. `md:static md:relative` inline vs. a `<768px`/`>=1024px` inline default with a `768px-1023px`-only fixed-drawer override), not a JS `window.innerWidth` check — matches this app's existing Tailwind-breakpoint-driven responsive components (`Sidebar.tsx`'s icon-rail/hamburger collapse, UX-DR4/UX-DR13).
  - [x] Submit flow: on "Confirm Renewal" — client-validate via `confirmRenewalSchema.safeParse` (mirrors `RecordRefundModal`'s exact pattern: field-level errors mapped via a `FIELD_ERROR_KEY` table, never `issue.message` shown directly), then call `confirmRenewalAction`. On success: call `dismissFrontDeskAlert(alertId)` (imported from `@/lib/realtime/frontDeskAlerts`, Story 4.6's existing function — do not write a new dismiss path), then `onRenewed()` (parent removes/collapses the panel). On failure: show `t("renewalPanel.errors.confirmFailed")` inline above the buttons (AC #3's exact required behavior — "panel stays open for retry"), do not close.
  - [x] No `<dialog>`, no `router.push`/navigation of any kind, anywhere in this component — a violation of this would fail AC #1's "no navigation away."

- [x] **Task 6: Wire `[Renew]` into `FrontDeskAlertPanel.tsx`** (AC: #1)
  - [x] Add a `[Renew]` `Button` next to the existing `[X]` dismiss button on every alert row (`FrontDeskAlertItem`, `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx:278-286`) — available on **all three** alert statuses (`expiring_soon`, `grace_period`, `expired`), matching the UX mockup's general "Alert content" spec (avatar, name, status, days message, `[Renew]`, `[X]`) which does not gate `[Renew]` by color/status.
  - [x] `FrontDeskAlertPanel` tracks which single alert (if any) has its panel open (`useState<string | null>` for the open `alertId`) — only one `InlineRenewalPanel` open at a time; clicking a different alert's `[Renew]` while one is already open replaces it (closes the old one). Render `InlineRenewalPanel` inline immediately below the corresponding `FrontDeskAlertItem` row when its `alertId` matches the open state.
  - [x] `onRenewed`/`onClose` both clear the open-panel state; `onRenewed` additionally does nothing else here — the alert's own removal from the panel is already handled by `dismissFrontDeskAlert`'s existing Realtime UPDATE broadcast (Task 5 already calls it) merging into the `FrontDeskAlertPanel`'s own TanStack Query cache exactly the way the `[X]` button already does. Do not duplicate that removal logic.

- [x] **Task 7: i18n** (AC: #1, #2, #3)
  - [x] `apps/dashboard/locales/en.json`/`fr.json`: add `"renew": "Renew"` to the existing `frontDeskAlert` block (`en.json:426-433`). Add a new top-level `renewalPanel` block: `title` ("Renew Membership"), `plan`, `startDate`, `startDateToday` ("Today"), `price`, `method` (reuse `payments.methods.*` values via `PAYMENT_METHOD_LABEL_KEY` — do not duplicate those 3 strings a third time; `payments.modal.methodOptions` already duplicates them once, which is pre-existing, not a pattern to extend further), `note`, `notePrefillCash` ("Paid at desk"), `noteCount` (`"{{count}} / min 5"`, matching this schema's actual 5-char minimum, not `payments.modal`'s "min 10" text), `cancel` (or reuse `common.cancel`), `close` (aria-label), `confirmButton` ("Confirm Renewal →"), `confirming` ("Confirming…"), `errors.reasonInvalid`, `errors.noActivePlan` (member has no subscription to renew — `getRenewalPreview`'s `not_found` case), `errors.confirmFailed` ("Renewal failed. Check your connection and try again." — UX's exact copy).
  - [x] Verify via `node scripts/check-i18n-key-parity.mjs`.

- [x] **Task 8: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) `confirm_renewal()` as a new atomic `SECURITY DEFINER` function combining a subscription reset and a directly-`verified` payment insert, and why (partial-failure/duplicate-payment risk of two separate RPC calls with a user-facing retry path; no independent-verifier gap exists for a renewal payment the same staff member both collects and confirms); (2) push N-04 is not sent — Epic 6 doesn't exist yet, this is the one literal AC clause this story cannot fulfill, pre-existing sequencing, not a defect; (3) Plan is read-only (no plan-switching-at-renewal), matching `renew_subscription()`'s own established YAGNI precedent; (4) start date is fixed to today, not editable/back-datable — Story 4.8 adds that; (5) `[Renew]` is wired up only from the front-desk alert panel in this story — the Subscriptions page and Overview's Expiring-This-Week table triggers named in the UX mockup remain unbuilt (4.8 and unassigned, respectively).

- [x] **Task 9: pgTAP coverage** (AC: all)
  - [x] New file `supabase/tests/inline_renewal_panel.test.sql`, seeding a gym/tier/member/plan/subscription fixture set (mirror `manual_renewal_reset.test.sql`'s or `refund_recording.test.sql`'s seeding style — check whether a `manual_renewal_reset.test.sql` exists from Story 3.2 and mirror its exact fixture shape if so):
    - Owner/manager/receptionist can call `confirm_renewal()` for a member in their own gym; coach and member roles cannot (permission denied).
    - A cross-gym `member_id` fails identically to a nonexistent one (no tenant-existence leak, matching `renew_subscription()`'s own tested precedent).
    - A deactivated member's renewal is rejected.
    - An empty/blank `p_reason` is rejected.
    - On success: exactly one new `subscriptions` row (`status = 'active'`, `start_date = current_date`, `expiry_date = current_date + plan.duration_days`) and exactly one new `payments` row (`status = 'verified'`, `subscription_id` = the new subscription's id, `amount`/`currency` matching the plan, `method` = the passed method, `actor_id` = the caller) are created.
    - Exactly one new `audit_log` row with `action_type = 'renewal_confirmed'`, correct `target_entity_id`/`target_entity_type`, and metadata containing `payment_id`/`subscription_id`/`amount`/`currency`/`new_expiry_date`.
    - A member with no existing subscription at all (`plan_id` lookup returns null) raises the expected exception.
  - [x] `rls_tenant_isolation.test.sql`: no new assertion needed — `confirm_renewal()` is `SECURITY DEFINER` and self-checks role/tenant internally rather than relying on a table RLS policy (same reasoning `renew_subscription()`'s own entry in that test file already follows, if one exists — check first).

- [x] **Task 10: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` — zero regressions against the pre-story baseline (467 assertions per Story 4.6's final count) plus this story's new file.
  - [x] Hands-on (per the project's WSL-only Supabase convention — see Dev Notes): trigger a `grace_period` or `expired` check-in to produce a front-desk alert, click `[Renew]`, confirm the panel opens pre-populated with the correct plan/price, submit with the default cash values, confirm the alert disappears, the member's subscription is now `active` with a new expiry, and a `verified` payment row with the right `subscription_id` exists. Repeat once forcing a submission failure (e.g., stop the local Supabase stack mid-submit) to confirm the panel stays open with an inline error and does not lose the entered field values.

### Review Findings

- [x] [Review][Patch] No idempotency guard on `confirm_renewal()` retry — fixed: added a `retryBlocked` state that disables Confirm (but not Cancel/close) on an ambiguous/thrown failure, only re-enabling it on a clean rejection response. [apps/dashboard/components/shared/RenewalModal.tsx]
- [x] [Review][Patch] `RenewalModal` can vanish mid-edit if its alert is dismissed/removed elsewhere while open — fixed: `FrontDeskAlertPanel` now stores a snapshot of the clicked alert row (`openRenewalAlert`) instead of re-deriving it from the live list every render. [apps/dashboard/components/shared/FrontDeskAlertPanel.tsx]
- [x] [Review][Patch] `payment_method` has zero DB-level validation after the enum removal — fixed: added `payments_method_not_blank_check` and `payments_method_length_check` (<= 40 chars) constraints. [supabase/migrations/0036_open_payment_method.sql]
- [x] [Review][Patch] `RenewalModal.handleSubmit` discards `error.message`/`error.code` — fixed: now surfaces `error.message` (falling back to the generic copy only if absent). [apps/dashboard/components/shared/RenewalModal.tsx]
- [x] [Review][Patch] Renewal-success alert-dismiss error is silently swallowed — fixed: `dismissFrontDeskAlert`'s returned error is now checked and logged (renewal itself already succeeded, so it's non-blocking but no longer silent). [apps/dashboard/components/shared/RenewalModal.tsx]
- [x] [Review][Patch] `mapTaraMoneyVendor()` can return `""` instead of `undefined` — fixed: falls back to `undefined` when normalization yields an empty token. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts]
- [x] [Review][Patch] `confirm_renewal:` error mapping is incomplete — fixed: added a `no_active_subscription` mapping (new `noActiveSubscriptionToRenew` locale key, en+fr) for the "has no existing subscription to renew" raise. [packages/types/src/errors.ts, packages/types/src/locales/{en,fr}.json]
- [x] [Review][Patch] `confirmRenewalSchema`'s 200-char Zod cap on `reason` had no DB-side match — fixed: added `payments_reason_length_check` (<= 200 chars). [supabase/migrations/0036_open_payment_method.sql]
- [x] [Review][Patch] Migration `0036_open_payment_method.sql` had zero pgTAP coverage — fixed: added `supabase/tests/open_payment_method.test.sql` (5 assertions: open-text method accepted, blank/overlong method rejected, overlong reason rejected).
- [x] [Review][Patch] `getRenewalPreviewAction`'s promise rejection wasn't handled — fixed: added a `.catch()` with a new `previewLoadFailed` locale key (en+fr) so an unexpected throw surfaces an error instead of an infinite loading state. [apps/dashboard/components/shared/RenewalModal.tsx]
- [x] [Review][Defer] `RecordRefundModal.tsx`'s `listRefundEligiblePaymentsAction` has no promise-rejection handling (stuck-loading on unexpected throw) [apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx] — deferred, pre-existing (Story 4.5 file, only touched by this story's dialog-theming className)
- [x] [Review][Defer] `payments.refundModal.errors.amountExceedsPayment` i18n key added with no wired-up consumer [apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx] — deferred, pre-existing (Story 4.5 file)
- [x] [Review][Defer] `docs/decisions.md`'s `NormalizedPaymentEvent.vendor` widening is currently unused downstream [supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts] — deferred, already self-documented and justified as forward-looking hygiene, not blocking

## Dev Notes

- **Read `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx`, `apps/dashboard/services/subscriptions.ts`, `apps/dashboard/services/payments.ts`, and `supabase/migrations/0022_manual_renewal_reset.sql` in full before starting.** All four already exist and this story extends them (or extends the pattern they establish) rather than starting from scratch. `0022`'s own comments are this story's closest and most authoritative in-repo precedent for a self-role-checking `SECURITY DEFINER` renewal function — `confirm_renewal()` (Task 1) should read as a natural sibling of `renew_subscription()`, not a divergent new style.
- **`packages/types` money/date/naming conventions** (snake_case at the DB boundary, camelCase for UI-local state, `{ data, error }` returns, `AppError { code, message }` shape via `mapSupabaseError`) apply identically to every new function in this story.
- **This project's local Supabase stack runs inside WSL2, not native Windows** — `supabase db reset`/`supabase test db`/`supabase gen types` must be run from a WSL shell, not PowerShell. This machine's WSL↔Windows Docker port forwarding was fixed after Story 4.6's original session hit it (see that story's Dev Agent Record) — expect a working hands-on pass, but if a fresh `dockerd` crash-loop reappears, `wsl --shutdown` + restart resolved it before.
- **Testing standard:** pgTAP is the primary automated coverage (Task 9). No automated E2E/browser test infrastructure exists in V1 — Task 10's hands-on pass is the only way to verify the actual panel UI/interaction flow; pgTAP only proves `confirm_renewal()`'s own DB-level correctness.
- **Do not build:** the Subscriptions page (4.8), Overview's stat cards/tables (unassigned), plan-switching-at-renewal, an editable/back-datable start date, or any push notification code (Scope Notes).

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0035_inline_renewal_panel.sql                          (new)
  supabase/tests/inline_renewal_panel.test.sql                               (new)
  packages/types/src/schemas/subscription.ts                                 (modified — confirmRenewalSchema)
  packages/types/src/database.ts                                             (regenerated)
  apps/dashboard/services/subscriptions.ts                                   (modified — confirmRenewal, getRenewalPreview)
  apps/dashboard/app/(dashboard)/subscriptions/actions.ts                    (new — no page.tsx yet, that's Story 4.8)
  apps/dashboard/components/shared/InlineRenewalPanel.tsx                    (new)
  apps/dashboard/components/shared/FrontDeskAlertPanel.tsx                   (modified — [Renew] button + open-panel state)
  apps/dashboard/locales/en.json                                             (modified)
  apps/dashboard/locales/fr.json                                             (modified)
  docs/decisions.md                                                          (modified)
  ```
  - `apps/mobile` and `apps/super-admin` are untouched by this story.
  - No changes to `apps/dashboard/lib/realtime/frontDeskAlerts.ts` — `dismissFrontDeskAlert` is reused as-is (Task 5), not modified.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.7] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-050] — alert Renew button opening an inline renewal panel, pre-populated plan/price/date, max 3 taps
- [Source: _bmad-output/planning-artifacts/epics.md#FR-032] — renewal resets subscription, dismisses alert, appears in payment history immediately (Story 3.2's original scope; this story is the first to actually wire the alert-dismiss half of it)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR3] — InlineRenewalPanel as a single reusable component, inline expansion (not navigation), tablet 320px drawer, 3-tap sequence
- [Source: _bmad-output/planning-artifacts/architecture.md lines 231-285] — Server Action/service-layer `{ data, error }` convention, the `renewSubscription` Server Action Pattern Example, snake_case/camelCase boundary rule
- [Source: _bmad-output/planning-artifacts/architecture.md line 342] — `components/shared/` houses both `FrontDeskAlertPanel` and `InlineRenewalPanel`, with an explicit `variant` prop note
- [Source: _bmad-output/planning-artifacts/architecture.md line 536] — Entity Relationships: "payments (0..1) --> subscriptions # a renewal payment links to the subscription it renewed" — this story is what finally populates `payments.subscription_id`
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 1540-1571] — Inline Renewal Panel: trigger points, presentation, exact field layout, 3-tap sequence, interaction rules, success/failure behavior
- [Source: supabase/migrations/0022_manual_renewal_reset.sql] — `renew_subscription()`'s full design rationale (role-check pattern, tenant-scoped lookup, renewal-as-history-not-mutation, YAGNI on plan-switching) — this story's closest precedent
- [Source: supabase/migrations/0030_payment_initiation_and_renewal.sql, 0031_manual_payment_verification_queue.sql] — `payments` RLS INSERT policy's `status = any(array['pending','processing'])` restriction that `confirm_renewal()`'s `SECURITY DEFINER` bypasses; `payments.subscription_id`/`provider_transaction_ref` column shapes
- [Source: supabase/migrations/0005_payments.sql, 0001_extensions_and_enums.sql] — `payments` table columns; `payment_method`/`payment_status` enum values
- [Source: supabase/migrations/0007_audit_log.sql] — `log_audit_event()`'s free-text `action_type` (no enum to extend for the new `'renewal_confirmed'` type)
- [Source: packages/types/src/schemas/subscription.ts] — `renewSubscriptionSchema`, and its own comment naming this story as its intended consumer
- [Source: packages/types/src/schemas/payment.ts] — `recordManualPaymentSchema`'s 3-value manual-method enum, reused verbatim by `confirmRenewalSchema`
- [Source: apps/dashboard/services/subscriptions.ts, apps/dashboard/services/payments.ts] — `renewSubscription`/`initiatePayment`'s existing conventions (validate-in-service-since-no-actions.ts-yet, `getCallerGymId`, "most recent subscription → plan" join pattern) this story's new functions follow
- [Source: apps/dashboard/app/(dashboard)/payments/actions.ts] — Server Action conventions (`"use server"`, thin validate-then-call-service, `{ data, error }` return) `subscriptions/actions.ts` follows
- [Source: apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx] — closest existing modal-form UI precedent (field-level error mapping, member-search-if-needed, submit/loading/disabled state) `InlineRenewalPanel` should follow for its form mechanics, while explicitly NOT reusing its `<dialog>` presentation
- [Source: apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx] — plain `<select>` dropdown pattern for `method`
- [Source: apps/dashboard/app/(dashboard)/payments/paymentLabels.ts] — `PAYMENT_METHOD_LABEL_KEY` reused verbatim for the renewal panel's method labels (not duplicated a third time)
- [Source: apps/dashboard/components/shared/FrontDeskAlertPanel.tsx] — current alert row structure (`FrontDeskAlertItem`), initials-avatar-fallback pattern, `dismissFrontDeskAlert` import, TanStack Query cache this story's `[Renew]` button and open-panel state extend
- [Source: apps/dashboard/lib/realtime/frontDeskAlerts.ts] — `dismissFrontDeskAlert`, reused as-is (Task 5)
- [Source: _bmad-output/implementation-artifacts/4-6-real-time-front-desk-alert.md] — Scope Notes precedent for documenting a deliberate UX-mockup deviation instead of silently over-building; the WSL/Docker environment note this story's Dev Notes repeats; the "front_desk_alerts is a new table, don't overload attendance_events" reasoning style this story's "confirm_renewal is one new function, don't split it" reasoning mirrors
- [Source: docs/decisions.md] — existing entry format/tone this story's Task 8 entry should match

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` applied `0035_inline_renewal_panel.sql` cleanly against the full migration chain (0001-0035), no errors.
- `supabase gen types typescript --local` diff reviewed line-by-line: the new `confirm_renewal` RPC signature is present as expected (`Args: { p_member_id, p_method, p_reason }`, `Returns: Record<string, unknown>` since `out` parameters have no named composite type, matching `renew_subscription`'s own `Returns: string` precedent for the same reason). The diff also includes `front_desk_alerts`/`payment_discrepancies`/`payment_webhook_events`/`refunds` table types and the `payment_discrepancy_type` enum, plus `run_payment_reconciliation_job` — all pre-existing DB objects from Stories 4.4-4.6 whose migrations were already applied but whose `database.ts` regen had never been committed in those stories' sessions (confirmed via `git log -- packages/types/src/database.ts`, last touched at the Story 4.3-era commit). Legitimate catch-up, not churn introduced by this story.
- `supabase test db`: 28 files, 498 assertions, all pass (467 baseline + 31 new `inline_renewal_panel.test.sql`). One transient failure was observed on an interim run (`check_out_manual_auto_timeout.test.sql` test 21, "exactly one success row is written to job_runs" — 2 rows instead of 1); isolated by temporarily removing this story's migration/test file and re-running, which passed cleanly at 467/467, then confirmed on immediate re-run with this story's files restored that it also passes at 498/498 — root cause is `check_in_auto_timeout`'s `pg_cron` schedule (`*/15 * * * *`, from 0024) occasionally firing during `supabase test db`'s wall-clock window depending on container-restart timing, unrelated to any table/function this story touches.
- `pnpm run typecheck` (all 4 packages via turbo): 0 errors.
- `node scripts/check-i18n-key-parity.mjs`: all 4 locale pairs in parity (347 keys in `apps/dashboard/locales`, up from prior count).
- **Hands-on browser verification, live** (WSL↔Windows Docker port forwarding confirmed working per this project's established convention): seeded a temporary gym/owner/member/plan/subscription/front-desk-alert fixture via the GoTrue Admin API + direct SQL (`docker exec supabase_db_gym_os psql`), started `pnpm dev`, logged in as the temp owner via Chrome automation. Confirmed: (1) the `[Renew]` button renders next to `[X]` on both `grace_period` (yellow) and `expired` (red) alert rows; (2) clicking it opens `InlineRenewalPanel` inline below the alert row, no navigation, pre-populated with the correct plan name/today's date/XAF price; (3) a straight-through cash renewal (defaults untouched) completes in the expected 3 taps — confirmed via direct SQL read afterward: new `subscriptions` row `active`/today/`+30d`, new `payments` row `verified`/`XAF 15000`/`cash`/correct `subscription_id`, one `audit_log` row `renewal_confirmed` with full metadata, and the alert's `dismissed_at` set; (4) reloading the page shows the alert gone. Then tested the AC #3 failure/retry path by temporarily `revoke execute on function confirm_renewal from authenticated`: submitting with a custom note showed the inline "Renewal failed. Check your connection and try again." error, the panel stayed open, and the entered note/method were retained (not cleared); re-granted execute and clicked Confirm Renewal again on the same still-open panel — the retry succeeded, verified via SQL (new `active` subscription, new `verified` payment with the retained custom note, alert dismissed). Deleted all temporary fixture rows and the two temp auth users afterward, then ran a final `supabase db reset` + `supabase test db` (498/498 pass) to leave the local stack clean.

### Completion Notes List

- Implemented all 10 tasks per the story spec: migration 0035 (`confirm_renewal()` atomic SECURITY DEFINER RPC), regenerated types, `confirmRenewalSchema` (extends `renewSubscriptionSchema`), `confirmRenewal()`/`getRenewalPreview()` services (the latter needed a new per-file `getCallerGymId` helper, this file's first non-RPC table read), `subscriptions/actions.ts` (new file, no `page.tsx` yet — that's Story 4.8), `InlineRenewalPanel.tsx` (this codebase's first inline-expanding/no-backdrop component, responsive tablet-drawer via Tailwind's default `md`/`lg` breakpoints since `tailwind.config.ts` defines no custom `screens`), `[Renew]` wiring + single-open-panel state in `FrontDeskAlertPanel`, i18n (`renewalPanel` block + `frontDeskAlert.renew`), `docs/decisions.md` entry, and 31 new pgTAP assertions.
- Added two `mapSupabaseError` branches in `packages/types/src/errors.ts` for `confirm_renewal:`-prefixed raise messages (not covered by the existing `renew_subscription:`-prefixed check) — without this, a real cross-gym/nonexistent-member error from `confirm_renewal()` would have fallen through to the generic "unknown" error copy instead of the existing friendly `member_not_found` copy. The deactivated-member mapping needed no new branch since that existing check has no function-name prefix guard.
- No push notification (N-04), no plan-switching, no editable/back-datable start date, and no Subscriptions-page/Overview wiring were built, per the story's own Scope Notes — all four documented in `docs/decisions.md`.

### File List

- `supabase/migrations/0035_inline_renewal_panel.sql` (new)
- `supabase/tests/inline_renewal_panel.test.sql` (new)
- `packages/types/src/schemas/subscription.ts` (modified — `confirmRenewalSchema`)
- `packages/types/src/errors.ts` (modified — `confirm_renewal:` error mappings)
- `packages/types/src/database.ts` (regenerated — new `confirm_renewal` RPC signature + catch-up types for Stories 4.4-4.6's previously-uncommitted schema objects)
- `apps/dashboard/services/subscriptions.ts` (modified — `confirmRenewal`, `getRenewalPreview`, `getCallerGymId`)
- `apps/dashboard/app/(dashboard)/subscriptions/actions.ts` (new — `confirmRenewalAction`, `getRenewalPreviewAction`)
- `apps/dashboard/components/shared/RenewalModal.tsx` (new, renamed from `InlineRenewalPanel.tsx` — converted to a `<dialog>` modal post-review, see Change Log)
- `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx` (modified — `[Renew]` button + open-panel state)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `docs/decisions.md` (modified)
- `apps/dashboard/app/(dashboard)/members/components/CsvImportModal.tsx` (modified — real `ArrowRight` icon replacing "→" text on 2 buttons, app-wide follow-up, not scoped to this story)
- App-wide dialog theming fix (found via `RenewalModal`, not scoped to this story — see Change Log and `docs/decisions.md`): `bg-background text-foreground` added to all 14 `<dialog>` elements —
  `apps/dashboard/components/shared/Sidebar.tsx`,
  `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx`,
  `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx`,
  `apps/dashboard/app/(dashboard)/members/components/CsvImportModal.tsx`,
  `apps/dashboard/app/(dashboard)/members/components/InviteMemberModal.tsx`,
  `apps/dashboard/app/(dashboard)/members/components/DeactivateMemberDialog.tsx`,
  `apps/dashboard/app/(dashboard)/attendance/components/CheckOutMemberConfirmDialog.tsx`,
  `apps/dashboard/app/(dashboard)/plans/components/PlansPageClient.tsx`,
  `apps/dashboard/app/(dashboard)/plans/components/PlanModal.tsx`,
  `apps/dashboard/app/(dashboard)/payments/components/VerifyPaymentConfirmDialog.tsx`,
  `apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx`,
  `apps/dashboard/app/(dashboard)/payments/components/FlagPaymentDialog.tsx`,
  `apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx`
  (all modified — one-line className fix each; `RenewalModal.tsx` above already includes it)
- Payment-method restriction opened app-wide, not scoped to this story — see Change Log and `docs/decisions.md`:
  `supabase/migrations/0036_open_payment_method.sql` (new — `payments.method`/`confirm_renewal()`'s `p_method` widened from the closed `payment_method` enum to `text`; enum dropped),
  `packages/types/src/database.ts` (regenerated),
  `packages/types/src/schemas/payment.ts` (modified — `initiatePaymentSchema.method` widened to an open string; stale enum comment fixed),
  `supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts` (modified — `NormalizedPaymentEvent.vendor` widened to `string`),
  `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts` (modified — `mapTaraMoneyVendor()` normalizes any operator instead of dropping unrecognized ones)
- Code review fixes (2026-08-01, see Change Log): `supabase/migrations/0036_open_payment_method.sql` (modified — added `payments_method_not_blank_check`, `payments_method_length_check`, `payments_reason_length_check`), `supabase/tests/open_payment_method.test.sql` (new), `apps/dashboard/components/shared/RenewalModal.tsx` (modified — `retryBlocked` state, surfaced `error.message`, checked dismiss error, `.catch()` on preview load), `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx` (modified — `openRenewalAlert` snapshot replacing `openRenewalAlertId` lookup), `packages/types/src/errors.ts` (modified — `no_active_subscription` mapping), `packages/types/src/locales/{en,fr}.json` (modified — `noActiveSubscriptionToRenew`), `apps/dashboard/locales/{en,fr}.json` (modified — `renewalPanel.errors.previewLoadFailed`)

### Change Log

- 2026-08-01: Story 4.7 implemented — inline renewal panel on the front-desk alert, backed by a new atomic `confirm_renewal()` RPC (subscription reset + directly-verified payment in one transaction). Status moved to `review`.
- 2026-08-01: Post-review, on user direction: `InlineRenewalPanel` renamed to `RenewalModal` and converted from an inline/no-backdrop expansion to a `<dialog>` modal, matching `RecordPaymentModal`/`RecordRefundModal`/`FlagPaymentDialog`'s established pattern (form-UI consistency across the app). This supersedes UX-DR3's original inline-expansion requirement — see `docs/decisions.md`. `pnpm typecheck` (dashboard): 0 errors. Behavior (pre-population, validation, submit/retry/error handling, dismiss-on-success) unchanged.
- 2026-08-01: User flagged the Cancel button as washed-out/low-contrast in the new modal. Root cause was app-wide, not local to `RenewalModal`: none of this app's 14 `<dialog>` elements set an explicit `bg-background`/`text-foreground`, so every modal's canvas color tracked the OS's native `prefers-color-scheme` instead of this app's own `.dark`-class theme, producing a dark dialog canvas with a light-themed `outline`-variant button on a dark-mode OS. Fixed all 14 (see File List) — see `docs/decisions.md` for the full writeup. Re-verified live via browser: modal now renders with correct light-theme background/text/button contrast. `pnpm typecheck` (dashboard): 0 errors.
- 2026-08-01: User asked for a real icon on "Confirm Renewal →"-style buttons instead of a text arrow character. Replaced the literal "→" with a `lucide-react` `ArrowRight` icon on all 3 buttons app-wide that had one baked into their locale string: `renewalPanel.confirmButton` (`RenewalModal.tsx`), `members.csvImport.validateButton` and `members.csvImport.confirmImportButton` (`CsvImportModal.tsx`); the "→" was removed from all 6 EN/FR locale entries. Re-verified live via browser (zoomed screenshot of the Confirm Renewal button). `pnpm typecheck` (dashboard) and i18n key parity: both clean.
- 2026-08-01: User direction: payment methods should not be locked to Cameroon ("we shall rapidly move out of Cameroon"). Scoped down to a schema-level fix only (currency/multi-country UI explicitly deferred, per user's own choice among presented options). `payment_method`'s closed 5-value Postgres enum opened to `text` (`0036_open_payment_method.sql`); `initiatePaymentSchema.method` widened from a 2-value enum to an open string; `mapTaraMoneyVendor()` normalizes any operator instead of dropping unrecognized ones. Key finding: TaraMoney was never actually told which operator to use (`network: ""` in the initiate request — it auto-detects from the phone number), so this change has zero effect on how TaraMoney processes a charge, only on what this app can record. Manual payment methods (cash/bank_transfer/manual_momo) untouched — those are receptionist-chosen instruments, not a country restriction. Full writeup in `docs/decisions.md`. `supabase test db`: 498/498 pass (no count change — no test asserted the enum's closed set). `pnpm run typecheck` (all 4 packages) and i18n key parity: both clean.
- 2026-08-01: Code review (bmad-code-review, scoped to this story's own File List — 29 files, ~2,780 diff lines) ran Blind Hunter + Edge Case Hunter + Acceptance Auditor in parallel. 3 decision-needed findings resolved with the user (retry-dedup approach, vanishing-alert handling, payment-method DB guard) and, together with 7 further patch findings, all 10 applied: `RenewalModal` now blocks Confirm-button retry on an ambiguous/thrown failure (`retryBlocked`) without blocking Cancel, surfaces the server's actual `error.message` instead of a hardcoded string, checks `dismissFrontDeskAlert`'s returned error instead of discarding it, and catches a rejected `getRenewalPreviewAction` call instead of hanging on "Loading…" forever; `FrontDeskAlertPanel` now holds a snapshot of the clicked alert (`openRenewalAlert`) instead of re-deriving it from the live list every render, so the modal survives the alert being dismissed/removed elsewhere while open; `0036_open_payment_method.sql` gained `payments_method_not_blank_check`, `payments_method_length_check` (<=40 chars), and `payments_reason_length_check` (<=200 chars, matching `confirmRenewalSchema`'s Zod cap), plus its own pgTAP file (`open_payment_method.test.sql`, 5 assertions); `mapSupabaseError` gained a `no_active_subscription` mapping for `confirm_renewal()`'s "has no existing subscription to renew" raise (reachable via a preview/confirm race, not just a "shouldn't happen" backstop); `mapTaraMoneyVendor()` now falls back to `undefined` instead of `""` for a vendor string with no alphanumeric characters. 3 findings deferred (all pre-existing gaps in Story 4.5's `RecordRefundModal.tsx`/`PaymentProvider.ts`, not touched substantively by this story) — see `deferred-work.md`. `supabase db reset` + `supabase test db`: 503/503 pass (up from 498, +5 for the new test file). `pnpm run typecheck` (all 4 packages) and i18n key parity: both clean. `supabase gen types`: no diff (CHECK constraints don't surface in generated types). Status moved to `done`.
