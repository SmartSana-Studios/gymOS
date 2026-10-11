---
title: '19-3 Charge-guests setting, session record & plan-type rules'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '0dd720b43fef5d52b018039c81c139f875187474'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Per-session guest charging (Epic 19) has no foundation: no per-gym switch, no session record, no `session` payment purpose, and plan type/price can be edited out from under paid sessions.

**Approach:** Migration 0107 adds the off-by-default `gyms.charge_guests_per_session` with one audited setter and its own pin trigger, the `guest_sessions` and `platform_session_config` tables, the `session` purpose, and a pinned `plans.plan_type`/`price` changed only through `update_plan_pricing`. The dashboard plan form, plan list and fee-waive dialog follow. No gym changes behavior: the flag defaults false.

## Boundaries & Constraints

**Always:** Role checks use `private.current_member_role()` (null fails closed); no `auth.jwt() ->> 'app_role'`. Every new or replaced function, trigger functions included, revokes EXECUTE from `public` and `anon` (19.1 gate). Setter and `update_plan_pricing` take the suspension guard (`private.current_gym_status() is distinct from 'active'`, message "is not active") after role checks and before any write. Flag column is `NOT NULL DEFAULT false`; the GUC is held only by `set_guest_charging`, and the pin is its own trigger function (not a branch of `protect_super_admin_only_gym_columns()`), firing for super admin and `service_role` too. `guest_sessions`: RLS on, SELECT for gym staff and own member, no write policy, `authenticated`/`service_role` grants SELECT only. Migration ends with a `do $verify$` block; regenerate `packages/types/src/database.ts` (splice, see decisions.md); all strings EN/FR.

**Never:** No flag flip to true anywhere (19.12). No session creation or consumption (19.4+). No redefinition of the notification trigger (already allow-lists `subscription`) or the payments staff-insert policy. No `loyalty_grant_id` FK. No gym-facing UI for `platform_session_config`. No Settings toggle (19.9). No change to existing `guest_sessions` rows from plan edits.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Toggle | Owner/Supervisor calls `set_guest_charging(true)` | flag set, audit row old/new | unchanged value: no write, no audit |
| Wrong role | Manager/Receptionist/Coach/Member | refused | permission denied |
| Suspended gym | Owner calls setter | refused | "is not active" |
| Direct write | UPDATE of the flag by any role incl. service_role/super admin | value pinned to old | N/A |
| Impact | `guest_charging_impact()` as Owner/Supervisor | count of non-deactivated members whose latest subscription is on a `pay_per_session` plan with price > 0 | other roles refused |
| Direct plan edit | UPDATE `plan_type` or `price` as authenticated | pinned to old; name etc. still editable | N/A |
| Price change | `update_plan_pricing` same type, new price | updated, audit old/new, `guest_sessions` untouched | N/A |
| Type change, no subs | type change with zero subscriptions | updated with consistent `duration_days`/`billing_interval` | N/A |
| Type change, has subs | any subscription references plan | refused, code `plan_type_locked` | `{code,message}` |
| Session insert | client INSERT payments `purpose='session'` | rejected by RLS | N/A |
| Dual source | `guest_sessions` row with both or neither of payment/grant | rejected by CHECK | N/A |
| Double consume | two consumed non-voided rows same member+day | rejected by partial unique index | N/A |

## Decisions

- `update_plan_pricing(p_plan_id, p_plan_type, p_price, p_duration_days, p_billing_interval, p_annual_discount_percent)` also writes the three shape columns, because the 0017 CHECKs couple them to type and cannot be satisfied across two statements.
- "Active member" for the impact count: `role = 'member'`, `deactivated_at is null`, latest subscription by `created_at` (no status filter; pay-per-session rows have no expiry).
- `platform_session_config`: Super-Admin SELECT and UPDATE policies per the AC, writes audited by an AFTER UPDATE trigger (gym_id null); seeded 7 / 60 / 90 days.
- The waive-dialog preset reason text is the chip label itself ("Session guest" / "Invité à la séance", 13 chars).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0098_registration_fee_foundation.sql:106-253` -- copy shape of separate pin trigger and `set_registration_fee` (replace its JWT role read with `private.current_member_role()`)
- `supabase/migrations/0050_messaging_provider_config.sql` -- singleton config table pattern (RLS, seed, audit)
- `supabase/migrations/0099_registration_fee_collection.sql:62-63` -- `payments_purpose_check` to drop and re-add with `session`
- `supabase/migrations/0017_*.sql:38-54`, `0093:101-110` -- plans CHECKs and `manager_or_owner_update_own_plans` (keep)
- `supabase/migrations/0090_*.sql` header -- suspension guard form; `0063:365` `log_audit_event` signature
- `supabase/tests/registration_fee_foundation*.test.sql`, `messaging_provider_config_rls.test.sql`, `tenant_suspension_enforcement.test.sql` -- pgTAP patterns; `suspension_rpc_coverage.test.sql` hard-codes 21 gated tables (update if new tables get `tenant_active_gate`)
- `apps/dashboard/services/plans.ts:177-230,234,298` -- `updatePlan` (split), `subscriptionCountForPlan`, `logPlanChange` (avoid double audit)
- `apps/dashboard/app/(dashboard)/plans/actions.ts:~90-150`, `components/PlanModal.tsx:290-315`, `components/PlansPageClient.tsx:105-115` -- action, form, list row
- `apps/dashboard/app/(dashboard)/members/components/WaiveRegistrationFeeDialog.tsx:78-94` (+ `.test.tsx`) -- preset chip
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` (+ `auditLabels.epic18.test.ts`) -- add Epic 19 event labels; `locales/{en,fr}.json`

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0107_charge_guests_setting_session_record.sql` -- flag, pin trigger, `set_guest_charging`, `guest_charging_impact`, `guest_sessions`, `platform_session_config`, purpose CHECK, plans pin trigger, `update_plan_pricing`, verify block
- [x] `supabase/tests/charge_guests_setting.test.sql` + `.negative.test.sql` -- one assertion per matrix row incl. suspension and direct-insert rejection; notification skip for a `session` row
- [x] `supabase/tests/suspension_rpc_coverage.test.sql` -- adjust count/exclusions if the meta-test requires
- [x] `packages/types/src/database.ts` -- splice new column, tables, functions
- [x] `apps/dashboard/services/plans.ts`, `plans/actions.ts` -- call `update_plan_pricing` for type/price/shape; map `plan_type_locked`
- [x] `PlanModal.tsx`, `PlansPageClient.tsx` -- locked read-only type with lock icon (`aria-readonly`, `aria-describedby`), per-session price label, "/ session" row, price-change and price-0 notes
- [x] `WaiveRegistrationFeeDialog.tsx` -- "Session guest" preset chip above Reason
- [x] `auditLabels.ts`, `locales/{en,fr}.json` -- labels and copy from the epic AC; `check:i18n` passes
- [x] `docs/decisions.md` -- record pin/GUC design, shape-column coupling, impact definition

**Acceptance Criteria:**
- Given every existing and new gym after 0107, then `charge_guests_per_session` is false.
- Given `scripts/ci-local.sh`, then every stage passes (guardrails, pgTAP, unit, e2e).
- Given a plan with subscriptions, when the form renders, then type is locked with the epic's EN/FR reason and a refused stale change shows it inline.

## Implementation Notes

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: static, pgtap, unit, e2e PASS

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | `updatePlan` RPC then name UPDATE is non-atomic; name collision leaves price/type applied while user sees error (edge, blind, gap) | medium | patch | Separate transactions; name collision is the common failure, so write name first (clean failure), then the RPC; no new surface |
| 2 | Supervisor passes RPC, then name UPDATE returns plan_not_found (edge, blind) | false | rejected | `manager_or_owner_update_own_plans` (0093:107-109) admits manager, supervisor, owner, same set as the RPC |
| 3 | Stale `plan_type_locked` leaves attempted type in form; resubmit loops (edge, blind) | medium | patch | PlanModal sets only `staleLocked`; `form.planType` keeps the refused type |
| 4 | Lock reason renders twice on stale lock (blind) | low | patch | Static `typeLockedReason` paragraph plus `fieldErrors.planType` carry the same string; drop the field error, paragraph is the inline copy |
| 5 | Flag pin is UPDATE-only; INSERT with true bypasses setter and audit (edge, blind) | low | rejected | Patch tried and reverted: an INSERT pin cannot tell the column default from an explicit value, so 19.12 `SET DEFAULT true` would force every new gym off (contradicts AD-32). Gym INSERT is not granted to clients. Recorded in decisions.md item 8 |
| 6 | No app-layer tests for updatePlan RPC mapping, hasSubscriptions, locked render (gap, blind) | medium | patch | Verified none exist; SQL tests exercise the RPC only, so a regressed caller stays green |
| 7 | Zero-price note misses "0.0"/"00" (edge) | low | patch | Direct correction: `Number(price) === 0` with non-empty guard |
| 8 | `consumed_at`/`covered_day` can be inconsistent, escaping the unique index (edge, blind) | medium | defer | Only 19.6b/19.7 definer code writes consumed rows; belongs with the consumption function |
| 9 | `guest_sessions.gym_id` not tied to member/payment gym (edge) | low | rejected | Only definer functions write the table; fix adds composite FKs |
| 10 | `platform_session_config.id` updatable; no-op updates audited (edge, blind) | low | rejected | Super admin only, no UI in V1.6; cosmetic |
| 11 | `subscriptions(count)` embed may be RLS-filtered/ambiguous (edge) | maybe-false | rejected | Staff who open the plan form read subscriptions of their gym; covered by new test in #6 |
| 12 | Preset chip overwrites typed reason; stores locale text; placed above Label (edge, blind) | low | rejected | Frozen intent specifies the chip fills the reason, above the Reason field |
| 13 | `plan_edited` metadata lost plan_type/price; audit viewer may blank (edge, blind) | false | rejected | Grep: no consumer reads those keys; `detailsLabel` renders any key/value |
| 14 | Pin claim "UPDATE pinned for any role" (edge claim) | low | rejected | Duplicate of #5 |
| 15 | Impact count ignores cancelled/suspended statuses (blind) | false | rejected | `subscription_status` has only active, expiring_soon, grace_period, expired; spec decision is no status filter |
| 16 | `payments.purpose` consumers (revenue, payments list) may bucket `session` as subscription (blind) | medium (unverified) | defer | No session row can exist until 19.4 (definer RPC only); settle by auditing revenue/list queries in 19.4 |
| 17 | Substring error mapping brittle (blind) | low | rejected | Message text is this migration's own; fix adds a custom SQLSTATE |
| 18 | Verify block incomplete, weak `like` (blind) | low | rejected | Straight-line DDL in one transaction; pgTAP asserts the same |
| 19 | `database.ts` hand-spliced; regeneration widens nulls (blind) | low | rejected | Known and documented in decisions.md; no CI drift guard exists for any splice |
| 20 | `membership_plans_rls` summary assertion can't tell RLS from pin (gap) | low | rejected | Per-statement 0-row assertions still cover RLS |
| 21 | PlanModal/PlansPageClient render rules for per-session label and notes untested (gap) | low | rejected | Cosmetic; locked-type render is covered by #6 patch; manual QA is the user's |
