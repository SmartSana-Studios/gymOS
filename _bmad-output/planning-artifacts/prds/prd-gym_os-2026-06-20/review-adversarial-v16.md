# Adversarial review - PRD V1.6 (session guests, loyalty, category)

Reviewed: prd.md v1.6 (Sections 1.2, 4.4, UJ-11, 6.27-6.29, NFR-021/022, 10.1, 12, OQ-16/19-24) against the v1.5 backup and the code at /workspaces/gym_os (migrations 0005, 0017, 0021, 0023, 0027, 0028, 0030, 0033, 0034, 0037, 0055, 0058, 0068, 0090, 0093, 0097-0101; apps/mobile checkin.ts and checkin.tsx; apps/dashboard plan actions).

## Verdict: READY WITH FIXES

The shape is sound and the rollout switch (FR-157) is the right call. But nothing may become a story until the 8 High findings are resolved in the text. Most are cheap spec clarifications; two (H1, H3) change what the spec is allowed to promise.

Counts: Critical 0 / High 8 / Medium 12 / Low 9.

Where a finding says "verified", it was checked against the cited migration or PRD line. Suspicions that did not hold are at the end.

---

## HIGH

### H1. The "gate" is a record-keeping gate, not an access gate; the headline promises overstate it (FR-159, G-13, 1.2, UJ-11, success metrics)
Check-in is a phone scanning a static QR (FR-042/043). There is no door, turnstile or staff gate in the product. `check_in()` (0090) only decides whether an `attendance_events` row is written. A guest who simply walks in without scanning, or who scans offline and never reopens the app online, is not recorded, not blocked, not alerted.
- UJ-11: "The app does not let her in" is untrue in the physical sense.
- Success metric: "100% of guest check-ins at those gyms are backed by a paid session by construction" is true only of scans, so it is near-tautological and does not measure the leak the intro (1.2) says gyms are losing.
- G-13 "every session-guest visit ... is a recorded, paid event" is not achievable by this mechanism alone.
- The leak-closing control is the receptionist noticing people who are inside but not checked in. FR-048/FR-047 already show "currently checked in"; nothing in V1.6 gives staff a "who is on the floor and unpaid" view.
Fix: reword G-13 and the metric to what the mechanism can deliver (scanned visits are paid; unscanned visits remain a desk-process matter), and decide whether a staff "admit/record visit on behalf" action exists (see M13). Consider a metric of paid sessions per gym per day against occupancy samples.

### H2. Class booking and class attendance are an ungated path (FR-105, FR-107, FR-159)
V1.6 text never mentions classes. FR-105: any member with an *active* subscription on any plan type can book. A Pay-per-session subscription is `active` forever (0021 skips `expiry_date is null`). `mark_class_attendance()` (0068) writes only `class_bookings`, never `attendance_events` (0068 header), and FR-107 says class attendance "uses the same member-status rules". So at a gym with charging on, a guest can book and attend classes with no paid session, and class attendance neither consumes a session nor earns a stamp. This is likely the most valuable thing a guest does at a studio (Pilates/Yoga are the new categories, FR-171).
Fix: state explicitly whether a class attendance (a) requires a usable paid session, (b) is priced separately, or (c) is out of scope and accepted. If (a), the same RPC consumption code must be reused or the bypass is only moved.

### H3. Client-supplied scan time plus "covers the whole calendar day" lets one payment cover unlimited replayed check-ins (FR-159, FR-161; 0028)
`check_in(p_scanned_at, p_client_scan_id)` takes any past timestamp from the client; it is only clamped when in the future (0028/0090). A fresh `client_scan_id` defeats the replay short-circuit. FR-161 says the server validates on sync and records attendance "under FR-159's rules", and FR-159 says a consumed session covers every check-in "until the end of that calendar day". Unstated: is the day taken from the scan time or the sync time? If the scan time:
- A guest who consumed a session on day D can send `p_scanned_at = D 12:00` on D+1, D+2 ... each with a new scan id, and each is "covered". The row is immediately stale-closed by the 0028 immediate-stale branch, so it looks like an old visit. One payment, unlimited covered check-ins; the blocked count and alert never fire. (Practical harm is bounded by H1, but it falsifies attendance and the Guest sessions card, and an old build or script needs nothing but its own JWT.)
- Conversely a scan-time of "before the payment" is retroactively covered by a payment made later, so sync-time evaluation turns "pay afterwards" into a valid path with unclear stamp/consumption semantics.
Fix: bound the accepted scan time (for example no older than the checkout timeout, or older than N hours is evaluated at sync time as a fresh visit), and say explicitly which timestamp drives coverage, lapse (7 days) and stamps.

### H4. Consumption / same-day coverage needs a per-member serialization point, and NFR-021's wording contradicts FR-159 (FR-159, NFR-021, FR-165)
Existing atomicity comes from the partial unique index on open check-ins (0023) and the lock on the open attendance row. Neither protects session consumption:
- If a member holds two paid sessions and two scans arrive concurrently (different scan ids, or one online one offline-sync), both read "no session consumed today", and both can consume a *different* usable session under row-level `for update skip locked` style code; with plain `update ... where consumed_at is null` the loser instead sees zero rows and wrongly gets blocked. Offline-sync rows are inserted open and closed in the same transaction (0028), so the open-row unique index does not serialize them either.
- NFR-021 requires that two simultaneous scans "cannot both consume it or both succeed on a single session". But FR-159 explicitly allows many successful check-ins on one consumed session (re-entry). Read literally the NFR forbids the designed behaviour and is untestable.
- The same lock must cover the stamp increment, otherwise the same race double-awards (NFR-022).
Fix: require a member-level lock (member row `for update` or advisory lock) around "find covering consumed session -> else consume one -> award stamp -> maybe grant free session", and restate NFR-021 as "never more than one session consumed per member per gym-local day, and never the same session twice".

### H5. Refunds: the existing refund path cannot honour "refunding an unused session voids it" (FR-162, FR-040; 0033, 0101)
Refunds are a plain INSERT into `refunds` under an RLS check (0033/0101): owner or manager, `amount <= p.amount`, unique on `payment_id`, no function in between. Therefore:
- A partial refund (e.g. 1 XAF of 2,000) is legal; the spec does not say whether it voids the session.
- "Unused -> void" versus a concurrent check-in consuming it is a race no RLS check can resolve. Outcome: guest enters and is refunded, or is refunded and still enters.
- FR-153 shows the project's own pattern (block "in the data layer, not only the interface"); FR-162 does not apply it.
- "Refunding a consumed one does not un-consume it" means pay -> check in (stamp earned) -> refund is a free visit plus a stamp; OQ-22 acknowledges the stamp but not the free visit or the pattern for a *manager*.
Fix: make session refund a function (or trigger) that locks the session row, voids only when unconsumed and only for a full refund, writes the audit row, and defines the partial-refund outcome. Decide the consumed-refund rule now, not in OQ-22.

### H6. Tara session payments: completion, late success, flagged and wrong-account outcomes are undefined and the existing completion function renews subscriptions (FR-158, FR-035, FR-124; 0100, 0053)
`complete_verified_payment()` (0100) has exactly two branches: `registration_fee`, and everything else = insert a new subscription from the member's latest plan. A `session` purpose will fall into the renewal branch unless the story adds a third; for a Pay-per-session member that silently inserts a new PPS subscription row and no session. The CHECK on `payments.purpose` (0099) currently allows only two values, so this will not be silent in tests only if the story adds the branch deliberately. The spec does not require it.
More important, behaviours the fee flow solved explicitly (0100 header) are absent for sessions:
- Webhook success after the attempt has been marked flagged/expired (fee flow: 10 minutes, then `registration_fee_late_payment` audit). Here the guest has really paid into the gym's account and has no session, is blocked at the entrance, and the receptionist sees "unpaid".
- `flagged` or wrong-account settlement (0053/0076) of a session payment.
- Member pays but the gym is suspended (check_in raises first, 0090).
Fix: add an FR stating the completion branch for `session`, that a late success still creates the session (preferable: it is the member's money) or generates an audit/alert row that staff can act on, and that a flagged session payment never produces a session and is visible to staff.

### H7. Desk payment path is not defined: verification queue, amount field, reason field, role list (FR-158 vs FR-033, FR-037, FR-038, FR-152)
- FR-152 explicitly says a manually recorded fee "takes effect immediately and does not wait in the verification queue (FR-037)". FR-158 omits this. FR-037 queues manual payments for confirmation; a cash session that waits for a second person defeats UJ-11 (guest standing at the desk).
- FR-038 lists "Amount" and "Mandatory reason / note" as required entry fields; FR-158 says the amount is never client-supplied and is always the plan price. FR-152 has the same unstated tension. For a per-visit event, a mandatory free-text reason on every session is real desk friction and invites "x" as the reason.
- FR-033: bank transfer is Manager/Owner only; FR-158 says "any staff role that can record payments" can record bank transfer sessions.
- Existing staff INSERT policy (0099) requires `purpose = 'subscription'`; sessions need a function like `record_registration_fee`, not the generic insert.
Fix: state immediate effect, the amount rule as an amendment to FR-038, a fixed/optional reason for session entries, and the role matrix per method.

### H8. The gate is keyed on mutable data: plan type and price can be edited in place; "current plan" means latest-created subscription (FR-159, FR-173, FR-025)
- `plans` has a manager/owner UPDATE policy (0017) and the dashboard `updatePlan` writes `plan_type` and `price` on a row that live subscriptions point to (apps/dashboard plans/actions.ts). A Manager (not just Owner) can flip a Pay-per-session plan to Monthly (a duration is required by 0017, so subscriptions with null expiry linger 'active' forever) or a Monthly plan to Pay-per-session, switching the gate for every member on that plan at once. Only `plan_edited` is audited; FR-157's audit covers the setting, not this.
- `check_in` resolves "current plan" as the most recent subscription by `created_at` (0027/0090). Assigning a cheap or 0-price Monthly plan to a guest, or any renewal row, flips them out of the gate.
- Price edits change what an already-paid but unused session "was worth" and what the next session costs; the spec says price is read "at the moment of payment" but not what a price change does to unused sessions.
Fix: lock plan_type on a plan that has subscriptions (or snapshot plan_type on the subscription), audit plan-type/price changes with an explicit link to FR-157, and define behaviour of unused sessions on price change.

---

## MEDIUM

### M1. No pending-payment guard for sessions (FR-158)
Member self-payment uses a one-`processing`-payment-per-member guard (0055) but it is Tara-only. Nothing stops (a) a double-tap creating two Tara collects (two charges, two sessions), or (b) a receptionist recording cash while a Tara collect is in flight (the fee flow refuses exactly this: `registration_fee_already_pending`, 0100). Result: two sessions, one lapsing unused in 7 days with the guest's money kept. Also `initiate_member_payment` rejects non-expiring statuses (0055), so a new RPC is needed; say so.

### M2. Which session is consumed first is unspecified (FR-166, FR-159, FR-165)
A member can hold paid sessions (7-day lapse) and a free session (60-day lapse). FR-166 says the free one is "consumed ... in preference to requiring payment", which could be read as "free first". Free-first lets the paid session lapse (member loses money) and skips the stamp; paid-first earns the stamp. Define the order (suggest: soonest-to-lapse first, paid before free only if both would otherwise lapse) and what the app shows.

### M3. Data model of "paid session" is undefined (FR-158, FR-166, NFR-021)
A paid session is "created by a payment" (FR-158), yet a free session is "a paid session of zero price" created by a rule with no payment (FR-166). NFR-021 needs a session entity for DB-level enforcement. If free sessions become zero-amount payment rows they pollute the Payments page, receipts (FR-041), revenue and `refunds`. State that a session is its own entity, 1:1 with a payment where purchased and with a loyalty event where free.

### M4. Stamp counters: one or two, and threshold change semantics (FR-164, FR-165, FR-167, FR-168)
- FR-164 says "progress is per member per gym" (one card) while having two rules with different thresholds (N vs K). A guest with 4 of N=5 stamps who is moved to a Monthly plan with K=2 earns a reward at their first renewal. A subscriber who drops to Pay-per-session earns toward N with renewal stamps. Say whether guest and subscriber counters are separate.
- "Changing N or K never erases progress; a member at or above a lowered threshold earns the reward at their next qualifying event". Unclear whether the counter then returns to 0 or to (count - threshold), i.e. whether 9 stamps with N lowered to 5 loses 4 stamps or yields a second reward.
- A guest who converts to a monthly plan (the outcome the program wants) loses their unspent free session silently (the gate no longer applies; it lapses in 60 days). State whether it converts, extends the first subscription, or is forfeited.

### M5. "On-time renewal" is not anchored to a recorded fact and there are several renewal paths (FR-167)
- `payments` has no verified-at timestamp (0005; only `created_at`, which for Tara is the initiation time, 0055/0100). "Verified on or before the expiry date" cannot be reconstructed from data except through the audit row.
- Initiated 23:55 on expiry day, confirmed 00:05: late or on time? The existing status machine uses UTC `current_date` (0021) while FR-159 uses the gym timezone; FR-167 does not say which "day" the expiry comparison uses, and at Douala (UTC+1) the two disagree for an hour each night.
- Renewal paths in code: `confirm_renewal` (payment + subscription, 0093, with `p_backdate`), Tara `complete_verified_payment` (0100), member self-renewal (0055 initiates; same completion), and `renew_subscription` (payment-less manual override, 0093). Each inserts a new subscription row; assigning a plan (including an upgrade or downgrade) inserts the same shape. Spec must say: payment-less override earns no stamp; plan change does/does not; backdated renewal (always late) earns none.
- Exactly-once is achievable and should be required in the same transaction: `complete_verified_payment` only moves rows out of `processing` (0100) so redelivery is a no-op (see Did-not-hold).

### M6. Renewal refund does not reverse stamp or reward (FR-162, FR-167, OQ-22)
OQ-22 covers only void/refund of a session payment. A refunded renewal payment (0033: refunds do not touch the subscription) keeps its stamp and its R free days, and R days are applied to the subscription row itself. Define whether refunding the K-th renewal removes the days, or accept it explicitly.

### M7. No affordability guardrail on rewards (FR-164, G-14)
K can be 2 and R up to 60: every second monthly renewal gives 60 days free, about a 50% permanent discount, with no warning, cap relative to plan duration, or cost projection. G-14 promises a program the gym "can afford"; only a retrospective metric exists. Add a plan-duration-relative cap or a displayed effective-discount percentage on the settings form.

### M8. FR-170's anti-fraud claim is stronger than the design (FR-170, FR-158, FR-162)
"A staff member cannot hand out free sessions silently" is not true: staff can record a cash session with no money collected (nothing verifies cash), run a payment-less `renew_subscription`, assign a free plan (H8), or refund after consumption (H5). Audit logging exists but nothing surfaces it. Add owner-visible signals: cash session payments by actor, refunds-after-consumption, and a per-actor count, or restate the claim as "no staff can edit stamps".

### M9. Rollout: day-one effects and the new alert type (FR-157, FR-160, FR-049; 0034, 0090)
- `front_desk_alerts.status` is `subscription_status` with a CHECK of three values and a one-active-alert-per-(member,status) unique index (0034). A new alert type needs a schema change, a dismissal rule (FR-032(a) dismisses on renewal; nothing says a session payment dismisses the payment-required alert), and dashboards tolerate unknown types (long-open tabs, see the update-available notice).
- Flipping the switch mid-day: a guest already paid in cash earlier but never recorded (everything pre-V1.6) is blocked on re-entry; every existing Pay-per-session member is blocked at their next scan and each triggers an alert. No preview, announcement or "tell guests" mechanism; the receptionist is flooded on day one. Suggest an owner-visible count of affected members before enabling, and an explicit statement that an already-open check-in is untouched.
- Old mobile builds: denial returns `null`, which they render as "membership expired - see the front desk" (checkin.ts `if (!data) return 'expired'`, checkin.tsx deniedExpired). Safe but misleading; if the story chose `raise exception` instead, old builds map it to the generic network error and the offline sync deletes the queue record (checkin.ts syncPendingCheckIns). The return contract must be specified.

### M10. FR-160 alert content and the blocked-attempt count (FR-160, FR-163)
- The alert should show an in-flight Tara payment for that member, or the receptionist double-collects (M1).
- "Blocked attempts" count: the existing alert row is deduped per member (0034); the separate attempts table (FR-160) counts every scan, so one impatient guest scanning five times is 5. Say whether the card counts attempts or distinct members, and de-duplicate by `client_scan_id`.

### M11. Timezone and window definitions (FR-159, FR-166, FR-168, FR-010)
- Coverage "until the end of that calendar day in the gym's timezone": is the covered day stored at consumption or recomputed? Timezone is editable after onboarding (FR-069/0014); recomputing changes coverage mid-day. Store the day on the consumed session.
- "7 days from payment" (timestamp) vs "60 days from the day it is earned" (day) vs "90 days" (unspecified) use three styles. State each as either 24h-multiples or gym-local calendar days.
- A guest at 23:30 whose visit crosses midnight is charged again at 00:30 (L1).

### M12. Offline outcomes: replay and cached state (FR-161; 0028, checkin.ts)
- The replay short-circuit (0028/0090) looks up `attendance_events.client_scan_id`. An unpaid offline scan creates no attendance row, so the scan id is not stored and a retry re-evaluates: it may later succeed after the guest pays, and inflates the attempt store. The attempts table needs the same idempotency key.
- The app must know the charging setting offline; stale cached state either shows "saved - will be verified" at a gym that turned it off, or the plain success at one that turned it on. Name the refresh rule.
- The queue is deleted on any non-recoverable result (checkin.ts), so a sync that races ahead of the receptionist's recording is dropped and the visit is never counted. Probably acceptable; say so.

---

## LOW

### L1. A visit that crosses midnight is charged twice (FR-159)
Late-night or 24/7 gyms: check in 23:30 (consume), check out 00:30, re-scan 00:45 needs a new session. Consider "calendar day or checkout timeout window".

### L2. Zero-price Pay-per-session plan (FR-156, FR-158)
`planSchema` allows 0 (0055 comments). A 0 XAF session cannot be collected via Tara and the manual amount rule is meaningless. Block the setting or treat price 0 as exempt.

### L3. Guests count toward the member cap (FR-073, FR-148)
Occasional guests are rows in `members`; at a busy gym they push the gym toward its tier cap. Not addressed; possibly intentional.

### L4. Loyalty on while charging is off (FR-157, FR-164, FR-165)
Guest stamps require consumed paid sessions, which do not exist when charging is off, so the guest rule is inert but the settings form will accept N. Say that N is hidden or disabled.

### L5. UJ-11 vs FR-165
UJ shows "5 / 5" with a free session waiting, FR-165 returns the count to 0 on reaching N, so the app can never show 5 / 5. Reword UJ-11.

### L6. Lapsed unused session keeps the guest's money with no warning (FR-159)
A paid, unused session lapses silently at 7 days. Needs at least an in-app expiry date (FR-169 only shows free sessions) and a refund-or-extend decision in the pilot.

### L7. 90-day window vs "a late renewal does not reset progress" (FR-167, FR-168)
A late renewal is not a qualifying event, so a member who renews late every month hits the 90-day reset even though FR-167 says late renewals do not reset progress. Also: reset by cron or lazily on next event? Lazy resets are not "reconstructible from the audit log" at the time (NFR-022) and the app must not display stale stamps after 90 days.

### L8. Category (FR-171, FR-172)
Sound and low-risk. Nits: the Owner can edit the category freely after V1.7 pages exist (impersonation/SEO trust is OQ-24); FR-007 amendment is fine; localized labels for "Autre" with no free text may disappoint a studio type outside the list.

### L9. Guest onboarding friction and the undefined receptionist "admit" action (FR-156, 4.4, OQ-19)
Walk-in guests must be a registered member with the app and OTP login (FR-019/FR-058), plus a fee waiver at fee-charging gyms, before they can scan at all. The 4.4 table lists "admit the guest after an unpaid-check-in alert" for the receptionist, but no mechanism exists besides recording payment (FR-160) and no staff check-in-on-behalf RPC exists in the code (only `check_out_member`). Define whether staff can record a visit for a guest without the phone; if not, delete "admit" from 4.4.

---

## Untestable or ambiguous statements (collected)
- "100% of guest check-ins ... backed by a paid session by construction" (metrics): near-tautology (H1).
- NFR-021 "both succeed on a single session": contradicts FR-159 re-entry (H4).
- "never silently counted and never silently dropped" (FR-161): unpaid offline rows live outside attendance, so "never dropped" needs the attempt-store idempotency (M12).
- FR-169 "in the member's language": fine, but "any free session earned with its expiry date" needs the day rule (M11).
- 10.1 gate 4 "each exactly once": testable only given the M5 path list.
- Metrics marked `[ASSUMPTION]` are fine, but "walk-away rate ... not followed by a paid session within 15 minutes" needs the attempts table to carry a member id and timestamp (it does) and a payment time to join to (cash `created_at`).

## Suspicions that did not hold up
- **Old app builds bypass the gate**: not possible. `attendance_events` is deny-all for clients (0023 header; 0026 only adds member/staff SELECT) and the only writer is `check_in()`. Enforcement inside that RPC applies to every build. Only the *copy* is wrong on old builds (M9).
- **A guest using two gyms**: no cross-gym use. `check_in` takes the gym from the JWT (`private.gym_id()`), `validateGymToken` only matches the caller's own gym, and members rows are per (user, gym). Sessions and stamps cannot be shared across gyms.
- **Coach or receptionist check-in on behalf of a member**: no such RPC exists; only `check_out_member` (0093). Coach has no payment role. The related real issue is the undefined "admit" (L9).
- **Webhook redelivery double-awarding**: Tara completion is already idempotent: `complete_verified_payment` updates `processing -> verified` once and no-ops otherwise (0100). Stamp and reward are safe if inserted in that same transaction; the PRD should say so (M5).
- **Lifecycle cron touching Pay-per-session**: it does not. `expiry_date is not null` excludes them (0021), and `subscriptions_current` returns them as plain rows. The spec's premise ("the plan has no expiry") is correct.
- **DST**: out of scope as instructed; the 0097 helpers already do gym-local day arithmetic.
- **Gym timezone change** is real but small (M11); not a security issue.
