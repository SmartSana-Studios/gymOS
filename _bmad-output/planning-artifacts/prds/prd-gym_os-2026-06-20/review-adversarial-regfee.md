# Adversarial review: registration fee (FR-147..FR-154, OQ-16, OQ-17)

Reviewer: adversarial, read-only. Scope: the uncommitted diff to `prd.md` (2026-10-07). Grounded against migrations 0003/0004/0005/0014/0018/0021/0022/0030/0031/0033/0035/0036/0037/0055/0090/0093/0095, `members/actions.ts`, `csvImport.ts`, `onboarding/plan.tsx`, dashboard/mobile `payments.ts`, `docs/decisions.md`.

## Verdict

**Not ready to hand to implementation.** The intent is clear and the user-confirmed decisions are faithfully captured, but the requirement text is wrong about the system in three foundational ways. (1) A member cannot currently exist without a subscription, and no payment path can take a payment without one. (2) The payments model has no "purpose" concept, so every downstream rule (unlock, refund-block, revenue line, receipt, webhook completion) has nothing to key on. (3) FR-148 contradicts FR-153 and is described as a rule on the member app, which does not create subscriptions. Separately, several PM proposals are written as settled fact, and FR-147's role assignment contradicts the actual RLS and the PRD's own Settings definition.

Counts: **Critical 3, High 6, Medium 5, Low 4.**

---

## CRITICAL

### C1. The fee cannot be collected: no "registered, unsubscribed" member state exists, and every payment path prices from a subscription
**Evidence.** Dashboard `createMember` -> `provisionMemberRow` inserts the member AND its subscription in one client-orchestrated sequence with compensating cleanup (`members/actions.ts` steps 3-5). `payments.member_id` is NOT NULL (0005), so a fee payment needs a members row first. `initiatePayment` (dashboard) looks up the member's latest subscription and refuses with `not_found` if none; it prices the payment as `plan.price`. `initiate_member_payment()` (0055) does the same server-side. `confirm_renewal` raises "no existing subscription to renew". There is no source of "amount = registration fee" anywhere.
**Failure scenario.** Owner sets a 5,000 XAF fee. Receptionist starts "add member". The form requires a plan and creates the subscription in the same step (it must be blocked by FR-148), so the member row never gets created, so there is nothing to attach a payment to. Alternative: member row is created without a subscription, a state the dashboard, members list, home screen, check-in (`v_status is null` -> denied) and `enforce_member_cap` have never had to represent. FR-151's "collect or waive in the same step where a plan would be assigned" is unimplementable until one of these is chosen. Tara Money collection (FR-151) is impossible via both existing initiators because the amount derives from a plan the member does not yet have.
**Fix (requirement level).** Define the lifecycle explicitly: a member may be created in a "registered, no plan" state when fee > 0; state which screens/list filters/badges represent it; state that the fee amount is its own pricing source (not plan price) for both the staff-initiated and member-initiated Tara paths; state that member creation and fee collection are separate steps with the plan assignment a third, and say who can perform each.

### C2. No payment "purpose" discriminator is required, and the webhook completion path treats every verified payment as a renewal
**Evidence.** `payments` has no kind/purpose column; `subscription_id IS NULL` is already the "common case for manual/unrenewed payments" (mobile `payments.ts` comment) so it cannot mean "fee". `complete_verified_payment()` (0030) turns ANY `processing -> verified` row into a renewal: it copies the member's latest plan and inserts a new `active` subscription. FR-151 says fee payments are "identified as such" but only lists display surfaces; nothing says this is a stored, server-enforced attribute. FR-152 (refund block), FR-143 (own revenue line), FR-041 (receipt), FR-148 (what satisfies the gate) all need it.
**Failure scenario.** A fee payment arrives via Tara webhook for a member who has any prior subscription (staff-assisted re-registration, a waived-then-paid mix-up, or a member with an expired subscription whom staff chooses to charge anyway). The webhook silently creates a new renewal subscription for the old plan. The gate is bypassed in the opposite direction (access granted by a path FR-148 never mentions) and the fee is booked as a plan renewal. For members with no subscription the function takes the defensive "no prior subscription" branch, so the money is verified, nothing is unlocked by the app, and there is no record of which obligation was settled.
**Fix.** Require a stored, immutable payment purpose (at minimum: subscription / registration fee), written at insert and never client-editable on the verify path. State explicitly that webhook completion of a fee payment must NOT create or renew a subscription. Make the purpose the single basis for FR-148 unlock, FR-152 refund-block and revenue split, and FR-041 receipt. Design it as an enum (OQ-16 per-visit charges will need a third value), not a fee-specific boolean.

### C3. Non-refundable + no uniqueness + no void path = unrecoverable duplicate or erroneous charges on live money
**Evidence.** FR-149 (non-refundable) and FR-152 (refund cannot be recorded) are both absolute. Nothing requires "at most one verified fee payment per member". Manual payments are free-entry (`recordManualPayment` takes `amount` from input; 0031 policy lets any receptionist insert `pending` and verify any pending row in the gym). `provider_transaction_ref unique` stops a double webhook (FR-035) but not two staff entries. `initiate_member_payment`'s "one processing payment" guard is member-level and covers only Tara, not a cash entry racing a Tara collect.
**Failure scenario.** Member pays 5,000 cash; receptionist A records it; B, not seeing it, records it again (or the member also pays by Tara from the app while A is in the queue). Two verified fee payments. The member is owed 5,000 and the system forbids recording the refund; the gym's MTD revenue (FR-143) is overstated forever; there is no sanctioned correction. Same for wrong-amount entries and a fee paid for a member then deactivated (FR-083: `complete_verified_payment` keeps a payment verified after deactivation).
**Fix.** (a) At most one verified-or-in-flight fee payment per member, enforced server-side (a second attempt is rejected with a clear message, including across cash/Tara). (b) Define a correction mechanism that is not a refund: e.g. Owner/Manager "void as duplicate/erroneous" with mandatory reason, audit-logged, excluded from revenue. State that "non-refundable" is a policy statement about the member's entitlement, not a ban on correcting recording errors. (c) State what happens to a fee payment verified for a member who is deactivated before use.

---

## HIGH

### H1. FR-148/FR-154 misdescribe the member app: onboarding does not assign a subscription, and blocking "confirmation" locks the whole app
**Evidence.** `onboarding/plan.tsx` only READS the existing active subscription (staff already created it; no-row -> `setNoPlanAssigned`, a non-retryable state). Its confirm writes `users.preferred_language` and `members.onboarding_completed_at`; the root auth gate is keyed on that column. FR-058 step 5 says the member "confirms or selects their pre-assigned plan", which matches. So "plan confirmation in the member app" is not a way a subscription is created, and FR-148's list of entry points is partly fictional.
**Failure scenario.** Staff register a fee-paying member without a plan; the member installs the app and gets `noPlanAssigned` instead of the "awaiting registration fee" state FR-154 describes. If instead the subscription exists but FR-154 withholds confirmation, `onboarding_completed_at` is never set, so the member cannot reach tabs, history, or classes (FR-083(c)-style access) even though they can do nothing wrong. A member in the existing live cohort who has an assigned subscription but has not yet onboarded must not see the fee screen (exempt) and this must be said.
**Fix.** Rewrite FR-154 against the real flow: say precisely which state(s) the member app shows (no-plan + fee unpaid / fee pending verification / fee waived or paid but staff haven't assigned plan), whether onboarding completion is blocked or not, and what the member can still do. Remove "plan confirmation" from FR-148's list of subscription-creating entry points, or state that it creates nothing.

### H2. Role contradiction: FR-147 lets a Manager set the fee in Settings; Managers have no Settings access and no gym UPDATE right. Supervisor is omitted everywhere.
**Evidence.** FR-069 and the nav table (line 511): Settings = Owner; Supervisor has "Manager-plus: Settings and Staff". 0014 `owner_update_own_gym` is `app_role = 'owner'` only; the BEFORE UPDATE trigger protects Super-Admin-only columns, so a new fee column on `gyms` needs both RLS and trigger consideration. FR-150 (waive) says "Owner or Manager"; the product also has Supervisor (0093), who outranks Manager.
**Failure scenario.** Implementer follows FR-147 literally and gives Manager a Settings field that RLS rejects, or widens the gym UPDATE policy for Manager, a privilege expansion nobody decided. Meanwhile a Supervisor cannot waive for a member but their subordinate Manager can.
**Fix.** State the role set explicitly for set-fee, waive, collect, verify, view-fee-status: Owner / Supervisor / Manager / Receptionist / Coach. If the user wants Manager to change a gym-wide price that must be a deliberate, tagged decision with its RLS consequence stated. Add audit logging for fee-amount changes (currently none required, though waiver is audited).

### H3. Verification now gates access, but the verification control model is unchanged and unspecified
**Evidence.** Manual payments are always inserted `pending` (0031 policy forbids inserting `verified`); a receptionist can record AND verify their own entry; subscriptions can only be inserted by Manager/Owner (0018). FR-151 says "only `verified` unlocks" but does not say who may verify a fee, whether self-verification is allowed, or whether recording and verifying can be one step (the existing `confirm_renewal` is the precedent: it inserts `verified` atomically via SECURITY DEFINER).
**Failure scenario (a).** Receptionist records a 100 XAF "cash" fee payment and verifies it, unlocking the plan with no check that amount equals the fee. **(b)** Cash at the desk: payer waits while payment sits `pending` in a queue, then waits for a Manager/Owner to assign the plan. Three actions, up to three roles, with the member standing there. FR-151's "same step" cannot hold under current RLS.
**Fix.** Specify: recorded amount must equal the fee in force when recorded (snapshot stored on the payment), or the payment cannot satisfy the gate; who may verify (and whether segregated from the recorder); whether the dashboard fee flow is one atomic record-and-verify for cash and which role can do it; and who may assign the plan after fee clearance.

### H4. Money semantics are undefined: partial, changed fee, 0, bounds
**Evidence.** FR-147 says whole XAF/default 0; says nothing about validation bounds (negative, absurdly large, > cheapest plan). FR-149 says fee changes "affect only members who have not yet paid or been waived" but not what a `pending`/`processing` fee payment recorded under the old amount does.
**Failure scenario.** Fee 5,000; payment recorded 5,000 pending; Owner lowers fee to 3,000 (or to 0, which per FR-147 switches the whole feature off) before verification. Is the member satisfied? Is the 5,000 booked? If a partial amount (2,000) was keyed and verified, is the member unlocked? "Paid" is currently undefined: is it "a verified fee payment exists" (derived) or a stored status (persisted)?
**Fix.** Define: satisfied = verified fee payment with amount >= (or exactly =) the fee snapshot taken at payment creation; the member's fee state (paid/waived/exempt/owing) is persisted and permanent once reached and is never re-derived from the current fee; lowering to 0 does not void in-flight payments; raising never creates retroactive debt; fee validated as non-negative integer with a stated maximum.

### H5. "Has, or has ever had, a subscription" is not a reliable exemption test
**Evidence.** `members` rows are per gym; 0003 says role changes go "deactivate-then-recreate" (new row, new `member_id`), so history keyed on `member_id` is lost. `provisionMemberRow` cleanup can leave an orphan member with no subscription. `idx_members_active_gym_user` allows a person at several gyms (FR-001).
**Failure scenarios.** (1) A returning member whose old row was deactivated and a new row created is "new" and charged, which contradicts OQ-17's claim that the deactivated-then-reactivated member "keeps status ... follows from FR-149" (true only if reactivation reuses the row; no member reactivation feature exists in the codebase to confirm). (2) A person who is a member at two gyms of the same owner pays at each; intended? unstated. FR-147's "per gym" and FR-149's "once per member" never say whether "member" is person, gym-member row, or owner-wide. (3) Gym turns the fee on later: members rows with no subscription ever (orphans from failed creation, or newly registered-but-unplanned) get charged; the "never charged retroactively" promise covers only members WITH subscription history. (4) A member who paid the fee but whose first subscription creation then fails: nothing says payment survives, so they could be asked to pay again.
**Fix.** Define the unit (gym-member row vs person within a gym; explicitly not owner-wide), state the exemption as a persisted marker set at fee-introduction/CSV/first-subscription time rather than a live history query, and state that paid/waived is permanent and independent of whether a subscription ever follows.

### H6. FR-148 vs FR-153 contradict, and "enforced server-side, no entry point can bypass it" is unimplementable and untestable as written
**Evidence.** FR-148 lists "CSV import (FR-008, FR-153)" among the paths where the rule "holds"; FR-153 says CSV import "is never blocked by FR-148". CSV members by definition have no prior subscription at import time (FR-009: no history migrated, so no payment either); a gate of "no prior subscription and no verified fee" would block them. Subscription rows are inserted by at least 11 sites: dashboard create, CSV, `renew_subscription` (0022), `confirm_renewal` (0035/0037/0090/0093), `complete_verified_payment` (0030, service_role), plus 0036 and the 0055 member-app flow, all SECURITY DEFINER or RLS-bypassing.
**Failure scenario.** An implementer adds a trigger on `subscriptions` insert; it blocks CSV and any renewal in the SECURITY DEFINER paths whose member has an odd history, or a naive version misses the service-role insert. No acceptance criterion can prove "no entry point can bypass".
**Fix.** Reword FR-148 to apply to the creation of a member's FIRST subscription only, explicitly excluding renewals/reset/cron/webhook renewal for any member who already has one, and CSV (via an explicit exempt marker). List the entry points as acceptance criteria and require tests per entry point, including a negative test that a renewal for an existing member still succeeds when the fee is on and when it is raised.

---

## MEDIUM

### M1. Member-app waiting state and offline behavior are unspecified
FR-154 promises an "awaiting registration fee" state but not how it learns of verification: a cash payment verified at the desk generates no push (`payments` realtime exists, 0051, but only for the payer's own watch). Offline: FR-061 queues check-in and shows success locally; the server later rejects (no subscription -> denied), so an unpaid member is shown "checked in". Require: refresh/realtime/push behavior for the waiting state, and that offline check-in for a fee-unpaid member does not display success.

### M2. Unpaid registered members consume the member cap
`enforce_member_cap` counts members rows. A gym at cap cannot register a new paying member; a gym can be filled with unpaid sign-ups. State whether unpaid members count and whether staff can discard a registered-never-paid member (FR-019 deactivation requires reason and, per FR-083(a), "sets the subscription to expired" which does not apply with none).

### M3. Tenant isolation and visibility not stated
Who can read a member's fee status/waiver reason (Coach? member?). The member app needs the fee amount: `gyms` is readable by any member of the gym, so a fee column is exposed to members, which is probably desired, but should be said. Super Admin escalated read of payments (0012/Story 1.14 allow-list of columns) must include the new purpose column or fee rows will be unattributed. Suspended-gym behavior (0073 gate) for fee collection should follow existing rule; say so.

### M4. Receipts, payment history, reconciliation and notifications assume payments are subscription payments
Mobile history/receipt show `planName: row.subscriptions?.plans?.name ?? null`, so a fee row displays as an unlabelled manual payment. FR-041's receipt fields include "plan" (a fee has none). Notification copy (0046) and reconciliation (0032, discrepancy categories) are phrased for subscription payments. Add to FR-151/FR-152: receipt field set for a fee, notification copy, reconciliation treatment, and the bilingual strings (FR-016).

### M5. Revenue line is not buildable on the existing aggregate, and the MTD caveat becomes sharper
`gym_revenue_mtd()` returns one bigint, filters `status='verified'`, buckets by `created_at` (initiation time, by design). "Own line" needs a different return shape and the purpose column (C2). A fee initiated on the last day and verified on the 1st lands in the earlier month. Requirement should say the split is "fees / subscriptions / refunds" and accept or reject the bucketing caveat. Also state that fee voids (C3) are excluded.

---

## LOW

### L1. Refund block needs server enforcement, not UI
`manager_or_owner_insert_own_refunds` (0033) only checks `status='verified'` and `amount <= p.amount`. FR-152 says a refund "cannot be recorded"; require it at the data layer (policy/constraint), including for Owner and the Super Admin paths.

### L2. Document hygiene
`version: "1.5"` unchanged (`updated` bumped only); no change-note in the PRD; FR-153 sits in 6.2 after FR-010 and FR-154 in 6.12, out of numeric order with 147-152 (acceptable under the stable-ID rule but makes the set hard to find); `addendum.md` and any data-model/section listing of `gyms`/`payments` columns not updated; memlog states the reviewer gate was not run at write time.

### L3. OQ-16 scope bleed
OQ-16 and the Out-of-Scope row correctly park per-visit charging, but FR-148 gates Pay-per-session plans on a registration fee while FR-024 still says they "pay per visit" with no mechanism; a Pay-per-session member who has paid the fee can check in free indefinitely. Acceptable as a staged delivery, but record it as a known interim state, and make sure the purpose enum (C2) is designed for it.

### L4. OQ-17 phrasing
"A reactivated member keeps their status; this follows from FR-149" is a design inference (see H5), and no member reactivation function exists in the migrations or dashboard, so the OQ describes a feature that does not exist. Reword as "no reactivation feature exists; if added, revisit."

---

## (i) Items stated as decided that the user did not decide

User-confirmed (per the brief, and the memlog's 2026-10-07 entries): flat per-gym fee default 0 = off; once per member; non-refundable; all plan types incl. pay-per-session; Owner/Manager audited waiver with mandatory reason; prior-subscription members exempt; CSV exempt; only verified unlocks; own revenue line; reactivated re-pay deferred; per-visit charging a follow-on. Everything below is PM proposal, written as fact, and not tagged:

| Item | Where | Issue |
|------|-------|-------|
| Owner **or Manager** sets the fee in Settings | FR-147 | Waiver roles were confirmed; fee-setter roles were not. Contradicts Settings = Owner/Supervisor (H2). |
| Receptionists and Coaches cannot waive; Supervisor unmentioned | FR-150 | Supervisor handling is a gap, not a decision. |
| Tara Money as a fee collection method into the gym's own account | FR-151 | Memlog lists "fee collected via existing methods" as a PM proposal; the later confirmation list does not enumerate it. Also see C1 (impossible as designed). |
| "In the dashboard, staff collect or waive in the same step where a plan would be assigned" | FR-151 | PM UX proposal; conflicts with RLS and member-must-exist (C1, H3). |
| Fee identified on Payments page, history and receipt | FR-151/152 | PM proposal (design of surfaces). |
| "Enforced server-side, no entry point can bypass" | FR-148 | PM design assertion, unverifiable (H6). |
| "Changing the fee later affects only members who have not yet paid or been waived"; "never charged retroactively when a gym introduces or raises its fee" | FR-149 | Extends the confirmed "prior-subscription members exempt" rule to fee introduction/raises; nobody discussed raising. |
| Whole of FR-154 except the copy | FR-154 | Only the copy is tagged `[ASSUMPTION]`; the blocking of onboarding confirmation, the Tara-vs-desk branching and the "awaiting" state are PM design and mischaracterize the app (H1). |
| "follows from FR-149 and is not a separate decision" | OQ-17 | PM inference, not a user statement (H5, L4). |
| "Direction decided (2026-10-07)" | OQ-16 | Matches memlog (per-gym price, at check-in, cash or app). The deny-at-check-in recommendation IS correctly tagged as PM. No finding. |

Recommendation: tag every row above `[PM PROPOSAL, awaiting confirmation]` in the PRD, and put the role set (H2), the fee-correction path (C3) and the first-subscription-only gate scope (H6) to the user as explicit questions rather than deciding them in the text.
