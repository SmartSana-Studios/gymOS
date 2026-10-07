# Epic 18 Context: Registration Fee — One-Time Fee Before a New Member Gets Access

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Gyms can charge a flat one-time registration fee (whole XAF, 0 = off). In a fee gym a newly created member is "awaiting registration fee": no member-app access and no plan or subscription of any type until staff collect the fee (cash, bank transfer, manual mobile money, or a staff-initiated Tara Money collection) or an Owner/Supervisor/Manager waives it with a reason. The fee is paid once per member, non-refundable, voidable only when recorded in error, and appears as its own line in month-to-date revenue. Existing members, CSV imports, and gyms with fee 0 are never affected.

## Stories

- Story 18.1: Registration fee setting, member state & first-subscription gate (migration 0098)
- Story 18.2: Payment purpose, manual fee collection & waiver (migration 0099)
- Story 18.3: Tara Money fee collection (migration 0100)
- Story 18.4: Void, refund block & revenue line (migration 0101)
- Story 18.5: Two-step member creation, first-plan assignment & import exemption
- Story 18.6: Dashboard fee collection, waive & void surfaces
- Story 18.7: Member app awaiting-fee blocked state & fee receipt

## Requirements & Constraints

- Fee is one integer amount per gym (not per plan type), never floating-point; default 0 means nothing else in the epic applies. Fee changes are audit-logged (old/new) and affect only members created afterward.
- Awaiting state is member-level and persisted; enforced server-side/in the database so no dashboard, import, or script path can bypass it. Members never pay the fee themselves from the app.
- Every member existing at release is treated as settled (including deactivated and non-member roles); a member created while fee is 0 is settled from creation and never charged retroactively. Fee is per gym.
- Awaiting members count toward the member cap.
- Fee payment amount is always exactly the gym's fee, read server-side; at most one non-voided fee payment per member.
- Waive: owner/supervisor/manager, reason mandatory, no payment row, not undoable. Void: owner/supervisor only, manual payments only, only while member has no subscription, reason mandatory, returns member to awaiting; it is a correction, not a refund. Tara-paid fees are corrected outside the platform.
- Collect: any staff role that can record payments. Refunds against fee payments are blocked in the data layer, not just UI.
- Awaiting member signing in sees a "registration not complete, contact the gym" message and no payment option; WhatsApp invite is sent only once the fee is settled.
- Out of scope: pay-per-session per-visit charging (OQ-16), reactivated-member re-payment (OQ-17), recording a payment for the first plan's price, widening the `gyms` UPDATE policy.
- NFRs: tenant isolation, integer money, append-only audit. All new strings bilingual EN/FR (`pnpm check:i18n`).

## Technical Decisions

- State column `members.registration_fee_settled_at` (NULL on a role=member row = awaiting), set by BEFORE INSERT trigger from the gym's fee; only SECURITY DEFINER functions/service_role may write it (self-update guard and staff direct writes pinned).
- Gate is a BEFORE INSERT trigger on `subscriptions` raising `registration_fee_not_settled`; renewal functions keep working for settled members.
- Fee setting changes only through `set_registration_fee` RPC (owner/supervisor, suspension-gated, audited); `registration_fee` is pinned against direct gym UPDATE.
- `payments.purpose` (`subscription` | `registration_fee`) as text + check; `payments.voided_at`; staff insert RLS restricted to `purpose = 'subscription'` so fee payments are created only via epic RPCs.
- `complete_verified_payment` gets a purpose branch (fee: settle member, never create a subscription); notification trigger skips fee payments.
- `gym_revenue_mtd()` keeps its signature but excludes voided payments; new `gym_registration_fee_revenue_mtd()` supplies the "of which registration fees" line.
- RPCs guarded by `private.current_gym_status()` (suspension coverage test stays green); migrations numbered from 0098 (renumber if another lands first).
- Migration backfill must carry a trailing `do $verify$` self-check; pgTAP positive + `.negative` companion files per story; regenerate `packages/types/src/database.ts`.

## UX & Interaction Patterns

- Fee field lives on the Settings page (owner/supervisor only), helper text "0 means no registration fee".
- Fee-gym member creation hides plan/status/expiry fields; members list gets an "Awaiting registration fee" badge/filter; collection modal reuses the Tara waiting/retry pattern and country-restricted phone input from `RenewalModal`.
- Role-based actions: receptionist Collect; manager Collect+Waive; owner/supervisor Collect+Waive+Void. UI mirrors RPC checks; RPC is authority.
- Overview revenue card shows a secondary "of which registration fees" line only when relevant.

## Cross-Story Dependencies

- 18.1 first and the only one touching production rows (safe behind default 0); 18.2 depends on 18.1; 18.3 and 18.4 depend on 18.2 (parallel); 18.5 and 18.7 depend on 18.1 (18.7 also 18.2); 18.6 last, surfaces everything.
- Tara path depends on existing Tara Money provider setup and the payment webhook; 18.3 needs sandbox verification.
