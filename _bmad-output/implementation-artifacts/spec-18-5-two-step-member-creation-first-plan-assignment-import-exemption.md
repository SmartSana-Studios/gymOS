---
title: 'Story 18.5: Two-Step Member Creation, First-Plan Assignment & Import Exemption'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 274fa1d46f3107c8c938477246eaaef2986254eb
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In a fee gym the dashboard still creates a member with a plan and subscription, which the Story 18.1 gate now rejects. A settled member with no subscription (a fee-gym member after collection) has no way to get a first plan, and imports and invites ignore the fee.

**Approach:** No migration. A fee gym creates the member with no subscription (awaiting). New `assignInitialPlan` inserts the first subscription. The members list shows and filters the awaiting state. CSV import settles each row through the service-role client. The WhatsApp invite waits for settlement.

## Boundaries & Constraints

**Always:** The fee is read server-side (`getGymSettings().registrationFee`), never from a client flag. Fee 0: the one-step flow, its fields, subscription insert and `member_created` audit metadata are unchanged. Fee above 0: if the input carries `planId`, `subscriptionStatus` or `expiryDate`, `createMember` returns `registration_fee_due` before creating anything; the awaiting `member_created` audit carries `{name, phone, join_date, awaiting_registration_fee: true}`. Map `registration_fee_not_settled` to `registration_fee_due` in `packages/types/src/errors.ts` (shared EN/FR copy, `lib/errors.registrationFee.test.ts` precedent). `assignInitialPlan(memberId, planId, startDate)` returns `{data, error}`, validates with a new `assignInitialPlanSchema` (`planId` is `z.string().min(1)` like `createMemberSchema`; `startDate` is `z.iso.date`), and works for owner, supervisor and manager only through the existing subscriptions INSERT policy (receptionist denied by RLS). It inserts via `insertSubscription` with `status 'active'`. The expiry is computed server-side from the plan's `duration_days` (`pay_per_session` gets none, as in `MemberModal.computeExpiryDate`), and the plan must belong to the gym. A member with any subscription returns `member_already_has_subscription`. An awaiting member returns `registration_fee_due` via the gate. It writes no payment and a `member_plan_assigned` audit row (`plan_id`, `start_date`, `expiry_date`). No cap check, since the member already counts. `provisionMemberRow` gains `importExempt`: when true it sets `registration_fee_settled_at` through the admin client between `insertMember` and `insertSubscription`. A failure there takes the existing cleanup and rollback path. The CSV import reads the fee and passes `importExempt` only when it is above 0, with `registration_fee_exempt: true` in each audit entry. `sendMemberInvite` returns `registration_fee_due` for an awaiting member and sends nothing. All new strings EN/FR and `pnpm check:i18n` passes.

**Never:** No migration. No "Assign plan" or "Collect fee" screen, modal or row action (Story 18.6 owns them). No change to `RenewalModal`, the RPCs, or the 18.1 triggers. No payment row for the plan price. No fee settling outside `importExempt`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fee-gym create | Fee > 0, identity fields only | Member created awaiting, no subscription, cap counted | N/A |
| Plan fields to fee gym | Fee > 0, client sends `planId` | Nothing created | `registration_fee_due` |
| Fee-0 create | Fee 0 | Unchanged | N/A |
| Assign plan | Settled member, no subscription, valid plan | Active subscription, expiry from plan, audit row | N/A |
| Assign to awaiting | Awaiting member | Nothing inserted | `registration_fee_due` |
| Assign twice / bad plan | Has a subscription / plan in another gym | Nothing inserted | `member_already_has_subscription` / `not_found` |
| Fee-gym CSV import | Fee > 0, N rows | Every row settled then subscribed, no payment, audit has `registration_fee_exempt` | Mid-file failure rolls all back |
| Invite | Awaiting member | No WhatsApp message | `registration_fee_due` |
| List | Awaiting member | Badge "Awaiting registration fee" and filter; a settled member with no plan keeps "no plan" | N/A |

</frozen-after-approval>

## Code Map

- `apps/dashboard/app/(dashboard)/members/actions.ts` -- `createMember` :42 (parse, cap :64, `getPlanTypeForGym` :82, `provisionMemberRow` :105, audit :123), `sendMemberInvite` :222 (check goes after `getMemberForInvite` :231); add `assignInitialPlan`. No role checks live here; RLS enforces.
- `apps/dashboard/services/members.ts` -- `ProvisionMemberRowInput`/`provisionMemberRow` :655-724 (make plan fields optional, add `importExempt`; `deleteMemberForCleanup` :628 is the admin-client precedent), `insertSubscription` :589 (reuse), `getPlanTypeForGym` :368 (extend or add a lookup that returns `duration_days`), `getMemberForInvite` :255 (return settled state), `listMembers` :112/:143/:220 (select `registration_fee_settled_at`, add the filter as `members.registration_fee_settled_at is null`, never an inner join), `logMemberChange` :969 (add `member_plan_assigned`).
- `apps/dashboard/services/csvImport.ts` -- `confirmCsvImport` :331-406 loop, rollback and audit metadata.
- `packages/types/src/schemas/member.ts` -- `createMemberSchema` :86; add a fee-gym identity schema and `assignInitialPlanSchema`; export via `index.ts`. Do not loosen the fee-0 schema.
- `apps/dashboard/app/(dashboard)/members/page.tsx` -- add `getGymSettings()` to the `Promise.all`; a failed read falls back to 0 with a log (the server stays authoritative). Pass `registrationFee` to `MembersPageClient.tsx` and then `MemberModal.tsx`.
- `MemberModal.tsx` -- step 2 (:598-690) holds the plan/status/expiry/join date; with fee > 0 omit plan, status and expiry from the form, the parse (:301) and the `createMember` call (:335). `memberLabels.ts` -- add `awaiting_registration_fee` to `MemberBadgeStatus`/`STATUS_BADGE_CONFIG`; `resolveBadgeStatus` yields it only when not deactivated, settled-at is null and there is no subscription.
- `MembersPageClient.tsx` -- `STATUS_OPTIONS`/`STATUS_LABEL_KEY` :29-37 (new filter), Invite item :390-405 and `InviteMemberModal` :493 (disabled, with an explanation, for awaiting members).
- `packages/types/src/errors.ts` :552-630 and `packages/types/src/locales/{en,fr}.json`; `apps/dashboard/locales/{en,fr}.json` (`members.*`, `audit.actionTypes`); `audit/auditLabels.ts` (`member_plan_assigned`); `docs/decisions.md` (dated entry, quoted heredoc).
- Tests: `actions.sendMemberInvite.test.ts` mocks `@/services/members` with an explicit export list, so new imports need stubs. `services/members.getMemberForInvite.test.ts` pins the select/`.eq` chain and must be updated. The files for `createMember`, `assignInitialPlan`, `provisionMemberRow`, `confirmCsvImport`, `listMembers` and `MemberModal` do not exist, so create them (precedents: `services/gym-settings.setRegistrationFee.test.ts`, `settings/actions.registrationFee.test.ts`). pgTAP (`registration_fee_foundation*.test.sql`) is unchanged.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/types` -- schemas, `registration_fee_due` mapping, EN/FR copy -- shared contract
- [ ] `apps/dashboard/services/members.ts`, `csvImport.ts` -- optional plan fields, `importExempt`, settled state in list and invite reads, fee-gym import, audit type -- data layer
- [ ] `apps/dashboard/app/(dashboard)/members/actions.ts` -- fee-aware `createMember`, `assignInitialPlan`, invite check -- server rules
- [ ] `members/page.tsx`, `MemberModal.tsx`, `MembersPageClient.tsx`, `memberLabels.ts`, `auditLabels.ts`, locales -- fee-gym form, badge, filter, disabled invite, labels
- [ ] Vitest for every matrix row, including the fee-gym CSV mid-file rollback; `docs/decisions.md`

**Acceptance Criteria:**
- Given `pnpm typecheck`, `lint`, `check:i18n` and the dashboard and types tests, then they pass.
- Given the full pgTAP suite, then it is still green with no migration added.
- Given a fee-0 gym, then the create, import and invite flows behave as before.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `registrationFee` prop chain page -> client -> modal untested; dropping the prop keeps all tests green (VG) | medium | patch | Every test mocks `MemberModal` or renders it directly. Test added with the real modal. |
| Admin `importExempt` UPDATE scoping (`gym_id`, `id`) not pinned by test (VG) | medium | patch | Test chain used passthrough `eq`; dropping a filter would pass. Assertions added. |
| Awaiting filter's `deactivated_at is null` clause unasserted (VG) | low | patch | One-line assertions in the `listMembers` and `exportMembersCsv` tests. |
| Concurrent `assignInitialPlan` calls both pass the no-subscription check, no unique index (Blind, Edge) | low | rejected | Real, but needs a double submit on a screen that does not exist yet (18.6); fixing it needs a migration or RPC, which the spec excludes. 18.6's modal must disable submit while pending. |
| Backdated or far-future `startDate` stored as `active` with past expiry; year < 100 / `toISOString` overflow (Blind, Edge) | low | rejected | Spec fixes `status 'active'`; only staff-entered extreme dates reach it; the fix adds branches. |
| Recurring plan with null `duration_days` gets no expiry (Blind, Edge) | false | rejected | `planSchema` requires a positive duration for every non-pay-per-session plan and 0017 backfilled the rest; the 0018 trigger rejects a null expiry anyway. |
| Deactivated member can be assigned a plan; archived plan accepted (Blind, Edge) | low | rejected | Spec is silent; the UI that exposes it is 18.6; reactivation flow unverified, so a filter could block a legitimate path. Plan lookup mirrors `createMember`. |
| "Awaiting" defined three ways: settled-at null with a subscription (Blind, Edge) | false | rejected | Not reachable: 0098 backfills every existing member as settled and its gate blocks a subscription insert for an awaiting member. |
| `?? null` default for the optional settled-at column reads as awaiting (Blind) | low | rejected | One caller selects the column; `exportMembersCsv` does not use the mapper; the field is required on `MemberListRow`. |
| CSV import bypasses the fee with no waive reason or role check (Blind) | false | rejected | FR-154 and the frozen spec make import exempt; the import is gated like member create and every row carries `registration_fee_exempt: true`. |
| Stale or failed fee read gives a misleading `registration_fee_due` / generic error (Blind, Edge) | low | rejected | Needs the fee to change between page load and submit; the server stays authoritative; the fix adds branches. |
| `addDaysToIsoDate` duplicates `computeExpiryDate`; weak "client flag" test (Blind) | low | rejected | Cosmetic; UTC date arithmetic handles leap days; the test does prove the fee comes from the server read. |
| `getGymSettings` returns null data and null error (Edge) | false | rejected | `getGymSettings` always maps a missing row to `gymNotFoundError`. |
| Audit `action_type` may need a migration (Blind) | false | rejected | `log_audit_event` takes free text; no CHECK or enum on `action_type` (grep of migrations). |
| Create form promises an Assign-plan flow that has no UI yet (Blind) | false | rejected | Frozen Never: UI is 18.6; Epic 18 is held from master. |
| Fee-0 create and import now fail if the settings read fails (Edge) | low | rejected | A failing `gyms` read would fail the create anyway; harmless extension. |
| Role probing before RLS denial; denial maps to `unknown`; orphan auth user on settle failure; `importExempt` with no `planId`; `subscriptionStatus` default (Blind, Edge) | low | rejected | RLS is the spec'd authority and reads are gym-scoped; the cleanup path equals the existing subscription-failure path; the last two are internal caller contracts. |

### Review Findings

Code review 2026-10-07 (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor; diff `274fa1d..a2fe3eb`). 0 decision-needed, 3 patch, 2 defer, 21 rejected.

- [x] [Review][Patch] No test pins `members/page.tsx` passing `registrationFee` to `MembersPageClient`; dropping the prop or the `getGymSettings()` read leaves every Vitest green and defaults a fee gym to the one-step form, which `createMember` then refuses [apps/dashboard/app/(dashboard)/members/page.tsx:54-91]. The earlier review's "page -> client -> modal" patch covered only client -> modal. Add `page.test.tsx` in the style of `page.overview.test.tsx`: fee 5000 reaches the client, fee 0 reaches the client, a failed settings read falls back to 0.  Fixed: `members/page.test.tsx` (3 tests; fails when the prop is dropped).
- [x] [Review][Patch] `docs/decisions.md` verification note says "Dashboard Vitest 678"; the review pass ended at 680/680 [docs/decisions.md:17] -- fixed (683 after the new page test)
- [x] [Review][Patch] `getMemberSubscriptionState` doc comment ("RLS alone would let staff of another gym through only if their claim matched") is garbled; say the explicit `gym_id` filter is defence in depth and keeps a cross-gym id on the `not_found` path [apps/dashboard/services/members.ts:400]
- [x] [Review][Defer] Concurrent `assignInitialPlan` calls can both pass the no-subscription pre-read and insert two first subscriptions (no unique index) [apps/dashboard/app/(dashboard)/members/actions.ts:assignInitialPlan] -- deferred: fix needs a migration or RPC (excluded here) and the only caller is the 18.6 modal, which must disable submit while pending; recorded so that requirement is not lost
- [x] [Review][Defer] `member_plan_assigned` (and the older Epic 18 action types) have no test that the audit label map resolves in both locales; a missing entry shows the raw string [apps/dashboard/app/(dashboard)/audit/auditLabels.ts] -- deferred: cosmetic and existing practice; one label-map test would cover all Epic 18 entries

#### Rejected

- `getGymSettings` null data with null error makes `createMember` look successful (Edge) -- false: `getGymSettings` maps a missing row to `gymNotFoundError`, so data and error are never both null.
- Awaiting members still awaiting after the fee is lowered to 0 (Blind) -- already in `deferred-work.md` (18.1 release sequencing: lowering the fee to 0 does not release them).
- Orphan `auth.users` row not asserted on settle failure (Blind) -- false as a defect: `provisionMemberRow` documents that a new placeholder auth user is deliberately not deleted on this path; the member delete is asserted.
- Deactivated member / archived plan accepted by `assignInitialPlan`; backdated `startDate`; `toISOString` overflow on a huge `duration_days` (Blind, Edge) -- low, already rejected in the earlier triage; the UI exposing them is 18.6 and the fix adds branches.
- Stale page-time fee gives a misleading `registration_fee_due` or generic error (Blind, Edge) -- low, needs the owner to change the fee between page load and submit; server stays authoritative.
- Stale client invite-menu state after settle or void (Edge) -- low, server check in `sendMemberInvite` is authoritative.
- Extra `getGymSettings()` query on every members page load (Blind) -- low, one cheap indexed read in an existing `Promise.all`; lazy loading adds complexity.
- CSV export labels awaiting members with a blank status (Blind, Edge) -- low, same blank as a settled member with no plan; the export's status column is the re-import template's, not a display column.
- CSV import UI does not announce the fee exemption (Blind) -- the exemption is the story's intent (FR-154, frozen spec); a notice is an 18.6-or-later UI decision.
- Weak "never trusts a client fee flag" test; `createAwaitingMember` duplicates `createMember`; `getServerTranslation` called twice (Blind) -- low, cosmetic or a refactor with no named divergence.
- Receptionist-denied test asserts `unknown` instead of a forbidden mapping (Blind) -- low, RLS is the spec'd enforcement; mapping belongs with the 18.6 screen.
- Fee-0 create and import fail closed when the settings read fails (Acceptance) -- low, already rejected earlier; the create would fail on a failing `gyms` read anyway.
- Awaiting filter has an extra `deactivated_at is null` clause (Acceptance) -- benign and documented in the decisions entry.
- Attendance page shows awaiting members as "no active plan" (Verification Gap) -- not in the spec; the spec lists only the members list.
- Spec frontmatter `status: done`, unchecked tasks and `review_loop_iteration: 0` disagree with sprint-status (Blind, Edge, Acceptance) -- the fix edits the spec under review; step 6 syncs status.
- Server and client define "awaiting" slightly differently (Acceptance) -- false: the difference is unreachable because 0098 blocks a subscription for an awaiting member; the server check is the stricter one.

## Design Notes

If the fee changes between the action's read and the insert, the 0098 trigger decides. The fee-0 path then hits the gate, which maps to `registration_fee_due`, and the existing cleanup deletes the member. The fee-above-0 path then creates a settled member with no plan, which `assignInitialPlan` handles.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm --filter @gymos/dashboard test` -- expected: exit 0
- pgTAP via `supabase test db` (or the pg_prove workaround in `docs/decisions.md`) -- expected: all green
