---
title: 'Story 18.1: Registration Fee Setting, Member State & First-Subscription Gate'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: f2bc4f325c483adc6893ab692d7e5743d9cffc14
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Gyms cannot charge a one-time registration fee, and nothing records whether a member has settled one or stops a plan being assigned before it is.

**Approach:** Migration 0098 adds `gyms.registration_fee` (default 0) and `members.registration_fee_settled_at`, backfills every existing member as settled, settles new members by trigger from the gym's fee, and gates `subscriptions` inserts in the database. Owner/Supervisor set the fee through `set_registration_fee` and a Settings field. Default 0 changes nothing for any gym.

## Boundaries & Constraints

**Always:** Whole XAF integer, `check (>= 0)`. The fee is read server-side from the row's own `gym_id`. NULL `registration_fee_settled_at` on a `role='member'` row means awaiting. Renewals and existing members never blocked. Awaiting members count toward the member cap (`enforce_member_cap` untouched, 0093:689-697 assertion untouched). New definer functions: `set search_path`, revoke PUBLIC execute, guarded by `private.current_gym_status() is distinct from 'active'` (raise text contains `is not active`) before any write. Whole existing pgTAP suite passes with no fixture edits. EN and FR strings, `pnpm check:i18n` passes.

**Never:** No settle/collect/waive/void RPCs, payment purpose, UI for member creation or plan assignment (18.2+). Do not widen `owner_update_own_gym` or touch `saveGymSettings`/`updateGymSettings`. Do not copy 0020's body for the members pin function (0063/0072 would be reverted). No `execute` dynamic SQL in new definer functions (pinned by `suspension_rpc_coverage`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backfill | Existing members rows, all roles, deactivated included | `registration_fee_settled_at = created_at`; `$verify$` asserts zero NULL | Migration aborts |
| Insert, fee 0 or role ≠ member | members INSERT | settled `now()` | N/A |
| Insert, fee > 0, role member | members INSERT (client value ignored) | NULL (awaiting) | N/A |
| Gate | subscriptions INSERT for awaiting member, any plan type incl. pay_per_session | rejected | `registration_fee_not_settled` |
| Renewal after fee 0→5000 | `confirm_renewal`, `renew_subscription`, `complete_verified_payment`; settled, expired or grace_period member | succeed unchanged | N/A |
| Cap | Gym at cap, insert awaiting member | rejected as today | `member_cap_reached` path |
| Set fee | owner/supervisor, amount ≥ 0 | column updated, `registration_fee_changed` audit with old/new; no member touched | negative amount, manager/receptionist/coach/member, suspended gym → error |
| Direct write | authenticated UPDATE of `gyms.registration_fee` or `members.registration_fee_settled_at` (staff or self) | pinned unchanged; service_role may write members column | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0097_gym_local_period_bounds.sql` -- latest; new file is `0098_registration_fee_foundation.sql`.
- `0072:247` `private.protect_self_managed_member_columns` -- latest members pin (self only; staff and service_role unpinned). `0077:246` `private.protect_super_admin_only_gym_columns` -- latest gyms pin; pins inside `if not private.is_super_admin()`, bypass by GUC set with `set_config(..., true)` in the definer RPC (copy `update_own_owner_notification_email`, `0072:296`). service_role is not exempt there.
- `0018:111` `enforce_member_cap`, `0094:123` phone-separation trigger -- existing BEFORE INSERT triggers on members (alphabetical firing). Only trigger on subscriptions: `enforce_subscription_expiry_matches_plan_type` (`0018:55`).
- `0093:286 confirm_renewal`, `0093:483 renew_subscription`, `0030:76 complete_verified_payment` -- insert subscriptions for existing members; do not redefine. `0063:365 log_audit_event`, `0063:19 private.current_gym_status`; `audit_log.action_type` is free text.
- RPC shape to copy: role check via `(auth.jwt() ->> 'app_role') = any(array[...])` (`0093:~413`), grants as `0096:~125-181`. `$verify$` shape: `0095:136-171`.
- `apps/dashboard/services/members.ts:589 insertSubscription` -- direct insert; unchanged here (fee-0 gym settles member first).
- `apps/dashboard/app/(dashboard)/settings/{page.tsx,SettingsForm.tsx,actions.ts}`; `services/gym-settings.ts` (`GymSettingsRow` :19, select :78-82, map :93-106); RPC wrapper to copy `services/billing.ts:299 updateOwnerNotificationEmail` + `saveNotificationEmail` action; standalone-save UI pattern `handleSaveNotificationEmail` (`SettingsForm.tsx:492`).
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`, `apps/dashboard/locales/{en,fr}.json` (`audit.actionTypes`, `settings.fields`, `settings.errors`).
- `packages/types/src/schemas/gym.ts:136` `gymSettingsSchema`; `packages/types/src/database.ts` gyms block :524-613 (hand-splice; CLI gen is broken here, see `docs/decisions.md`).
- Tests to extend with the new field/mocks: `SettingsForm.billing.test.tsx`, `SettingsForm.payments.test.tsx` (`INITIAL_SETTINGS`, `./actions` mock), `actions.payNow.test.ts`, `actions.paymentProvider.test.ts`. Service test pattern: `gym-settings.getGymLocalPeriodBounds.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0098_registration_fee_foundation.sql` -- add both columns; backfill; BEFORE INSERT members trigger (definer, reads fee by `new.gym_id`, named to avoid disturbing `enforce_member_cap`); BEFORE UPDATE members trigger pinning the column when `current_user in ('authenticated','anon')`; BEFORE INSERT subscriptions gate; pin `registration_fee` in gyms function via GUC; `set_registration_fee(p_amount integer)`; `$verify$` block -- schema + safety
- [x] `supabase/tests/registration_fee_foundation.test.sql` and `.negative.test.sql` -- cover I/O matrix, role matrix, suspended gym, cross-gym, direct writes, NULL-backfill, cap, renewals after fee change
- [x] `packages/types` -- `registrationFeeSchema` beside `gymSettingsSchema`; splice `database.ts`
- [ ] Dashboard service + action + `SettingsForm` field with own Save button, `GymSettingsRow.registrationFee`, select/map; update existing fixtures and mocks; Vitest for service, action, field
- [x] `auditLabels.ts` + EN/FR locales -- `registration_fee_changed`, field label, hint "0 means no registration fee", error
- [x] `docs/decisions.md` -- dated entry (pin mechanism choice)

**Acceptance Criteria:**
- Given the full pgTAP suite, when run unmodified, then green; new files green.
- Given `pnpm typecheck`, `lint`, `test`, `check:i18n`, then pass.
- Given an Owner or Supervisor on Settings, when they save a fee, then the RPC is called and an audit row appears with EN/FR label; a Manager has no route to the field.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| decisions.md entry corrupted (`$verify$` expanded into duplicate header) | medium | patch | Confirmed at lines 9 and 17; repaired directly. |
| set_registration_fee role gate fails open on missing `app_role` claim | low | patch | `not (null = any(..))` is NULL so `if` does not raise; only the gym_id check remains. Practically unreachable, one-line fix. |
| definer-writes-column premise never tested through a real SECURITY DEFINER function | medium | patch | Negative test uses `reset role` as superuser; nothing proves 18.2-18.4's premise. |
| No test for JWT with gym_id but no app_role | low | patch | Paired with the role-gate fix. |
| Owner sets fee > 0 with no settle path (18.2-18.4 not shipped); awaiting members stuck, lowering fee to 0 does not release them | medium | defer | By design: epic scope puts the field in 18.1 and AC says no existing member is touched. A release-sequencing risk, surfaced to the human at present. |
| `registration_fee_not_settled` has no friendly dashboard mapping | low | defer | 18.5 AC explicitly surfaces it as `registration_fee_due`. |
| Fee field and Save render for any role that opens /settings (page has no role guard) | low | defer | Pre-existing: the whole Settings page is nav-gated only; RPC is the authority and rejects. |
| Typed fee silently unsaved when main Save is clicked | low | defer | Same pattern as the existing notification-email field; UX follow-up. |
| anon can still EXECUTE set_registration_fee | false | rejected | `has_function_privilege('anon', ...)` is false on the local DB; anon also fails the role check. |
| Pin deny-list (`authenticated`, `anon`) misses other roles | false | rejected | PostgREST sessions only run as those two; deny-list is the spec's decision. |
| Insert trigger overwrites explicit settled value for service_role | false | rejected | Spec/18.5 design: import settles by UPDATE after insert. |
| Fee read without lock racing set_registration_fee | false | rejected | Serialization before or after the change both yield a valid state. |
| set_registration_fee UPDATE affecting 0 rows still audits | false | rejected | Missing gym makes `current_gym_status()` NULL, which raises before any write. |
| Backfill UPDATE fires other triggers / bumps updated_at | false | rejected | No updated_at or audit trigger on members; the self pin needs `auth.uid()`, null in a migration. |
| Raw RPC error text shown in field; thin client tests; hardcoded Zod English; brittle `prosrc` asserts | low | rejected | Matches existing patterns (billing email field, gymSettingsSchema, 0093/0095 asserts); fixes add complexity for negligible harm. |

## Design Notes

Pin choice: inside a SECURITY DEFINER function `current_user` is the function owner, and service_role is its own role, so only `authenticated`/`anon` sessions are pinned. This needs no GUC and lets 18.2–18.4 RPCs and 18.5's service-role import exemption write the column. The new trigger also covers a member self-settling, which satisfies the epic's "extend `protect_self_managed_member_columns`" intent without touching that function. The gyms pin uses the repo's GUC pattern because service_role is not exempt there.

## Verification

**Commands:**
- `supabase test db` (or the pg_prove workaround in `docs/decisions.md`) -- expected: all pgTAP green
- `pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm --filter @gymos/dashboard test` -- expected: exit 0

### Review Findings

Second review pass (2026-10-07, bmad-code-review: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor over `f2bc4f3..240445d`). 33 raw findings -> 1 patch, 1 defer, 31 rejected.

- [x] [Review][Patch] `docs/decisions.md` verification note says 2152 pgTAP tests; the two new files declare `plan(26)` each, and the post-review count recorded in sprint-status is 2154 (2102 + 52) [docs/decisions.md:19]
- [x] [Review][Defer] The fee field ships before any way to settle it -- with a fee above 0, every new member is awaiting and cannot be subscribed, and nothing in 18.1 releases them (fee back to 0 does not). Add Member (`provisionMemberRow` -> `insertSubscription`, then `deleteMemberForCleanup`) and CSV import therefore fail for that gym, the raw `registration_fee_not_settled` error has no friendly mapping in `packages/types/src/errors.ts`, and no test runs `provisionMemberRow`/`createMember`/import against a fee > 0 gym [supabase/migrations/0098_registration_fee_foundation.sql:enforce_registration_fee_settled; apps/dashboard/services/members.ts:~700] -- deferred: medium (unverified end to end), by design -- 18.2-18.5 own settle/collect/waive, two-step creation, import exemption and `registration_fee_due` mapping. Epic 18 is held from master until all 7 stories are tested, so no real gym can set a fee in the interim; 18.5's tests must cover `provisionMemberRow` and the import with fee > 0, and 18.2 should decide whether lowering the fee to 0 releases awaiting members. (Re-surfaces the earlier pass's release-sequencing item.)

#### Rejected

- `false` -- complete_verified_payment would charge an awaiting member then fail the gate: it only renews from the member's most recent existing subscription and returns early ("no subscription to renew") when there is none; an awaiting member cannot have one.
- `false` -- backfill UPDATE fires every members BEFORE UPDATE trigger: checked `pg_trigger` on the local DB; `enforce_staff_member_phone_separation_trigger` is `UPDATE OF role, user_id, deactivated_at`, so it does not fire; `protect_self_managed_member_columns` needs `auth.uid()` (null in a migration).
- `false` -- set_registration_fee EXECUTE retained by anon/service_role: `has_function_privilege` is false for both on the local DB (true only for authenticated).
- `false` -- role change staff -> `member` skips the fee: `update_staff_role` rejects any target that is already `member` and any `p_role` outside supervisor/manager/receptionist/coach.
- `false` -- `protect_super_admin_only_gym_columns` rewrite may revert later changes / no regression coverage: 0077 is the latest prior definition (grep of migrations) and the body is verbatim apart from the new pin.
- `false` -- insert trigger overwriting the value contradicts the service-role-import claim: the claim is about UPDATE (post-insert settle), which is the spec's 18.5 design (earlier triage, same verdict).
- `low` not worth fixing -- gate is BEFORE INSERT only, so UPDATE of `subscriptions.member_id` could re-point onto an awaiting member: spec scopes the gate to inserts, no app path updates `member_id`; only a deliberate staff API call reaches it.
- `low` not worth fixing -- Settings fee field visible to non-owner/supervisor: nav restricts `/settings` to owner and supervisor (Sidebar `NAV_ITEMS`), direct URL reaches a field whose RPC rejects; pre-existing page pattern (earlier triage, same verdict).
- `low` not worth fixing -- trigger functions are definer without the suspension guard: they write no table (documented in the migration header); a guard would add nothing to a read-only check.
- `low` not worth fixing -- unchanged amount writes no audit row: documented, tested decision.
- `low` not worth fixing -- both pins revert silently (no raise): spec's decision, documented trap; raising would change the contract.
- `low` not worth fixing -- oversize amount shows the generic "whole amount" message / no business ceiling; stale local fee state after another tab's change; typed fee lost on main Save (same as the notification-email field); double Enter during save (input disabled, RPC idempotent on unchanged amount).
- `low` not worth fixing -- backfill is one unbatched UPDATE: members table is small and the migration is one-shot.
- `low` not worth fixing -- test gaps (anon pin branch, large `p_amount`, cross-gym gate, i18n key sync test, mocked `react-i18next`): RLS blocks anon, other paths are covered by `check:i18n` and existing positive controls.
- `low` not worth fixing -- `(0093:689)` line citation, no `sprint-status` entry in the diff, Dashboard task still unchecked in the spec: line-rot is tracked repo-wide; sprint-status is written by this step; the fix for the checkbox is to edit the spec.
