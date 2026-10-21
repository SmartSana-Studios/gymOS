---
title: '23-8 Audit Under the Individual, Disclosure & Member-Facing Surfaces'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '03760315c92f551a81ba7912427a10c37e4213d3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 0141 the real support person is recorded nowhere, so GymOS cannot hold them accountable (FR-187), gym screens that resolve "recorded by" through `members` show a blank for the proxy, the member app has no rule for support-made records (FR-195), and an Owner cannot ask about a specific audit row.

**Approach:** One migration adds `support_action_identity` (Super Admin read only) written at the same choke points as the proxy actor, an Owner disclosure request on an audit row with Super Admin answer, and a configured answer window. Gym and member screens map the proxy to "GymOS Support" (gym side) or to the gym (member side). A per-surface pgTAP/unit scan proves no surface returns the real person.

## Boundaries & Constraints

**Always:**
- `support_action_identity(subject_table, subject_id, real_user_id, gym_id)`: RLS on, no client policy, read only by a Super Admin function at live AAL2. Written in the same transaction as the action, for every converted writer (audit, payments, refunds, `connected_by`, `updated_by`, `dismissed_by`); a support action with no identity row fails the action.
- Displayed actor is server-derived only; client-supplied actor values stay ignored (extend the 0141 scan to the new writer helper).
- Surfaces covered by a per-surface test as Owner, Supervisor and Manager of a gym where support acted: staff list, audit trail, payment recorded-by, refund approvers, member notes, check-ins, CSV exports, Realtime payloads, notifications, error logs. None returns the real id, name, phone or email.
- Gym side: a proxy actor renders "GymOS Support" (payments, refunds, waived-by, audit actor filter). Member side (mobile payment detail, receipts, message templates): a support-created record shows the gym, never a person or "GymOS Support" as a person.
- Disclosure request: Owner files against one audit row of their own gym; stored, visible to Super Admin, answered outside the product within `disclosure_answer_business_days` = 3 `[ASSUMPTION]` read from `private.session_limit()`; request and answer each write an `audit_log` row. EN/FR for Owner text.
- Historic rows holding a real support id (written under 0140) are checked by a read-only query and the result recorded in decisions.md before support is enabled.
- Rollback script; guardrails clean; local only, not applied to production.

**Never:**
- No payment connection flow (23-9), no revocation/velocity/lifecycle work (23-10, 23-11), no new support capabilities.
- No individual's name in any gym or member response, including error text and logs.
- Do not enable support for any gym until this story and the historic-row check are closed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Support records a payment | live support session | gym row shows proxy id; one identity row holds the real id | no identity row, no action |
| Super Admin read | AAL2 Super Admin / any gym role | full identity rows / zero rows or denied | N/A |
| Owner views audit/payment | support acted | "GymOS Support", never a person | N/A |
| Member opens receipt | support-recorded payment | gym shown, no person | N/A |
| Disclosure request | Owner, own-gym audit row | stored, audited, visible to Super Admin | other gym's row or non-Owner refused |
| Answer | Super Admin | stored, audited, shown to Owner | N/A |
| Client sets actor | payload actor value | ignored | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0141_support_proxy_actor.sql` -- `private.actor_id()` 105-127, `support_force_actor` 132-149, `log_audit_event` 153-213 (insert ~202 returns `v_id`), converted writers (217, 351, 449, 576, 693, ~933, ~982, ~1029). Next migration 0142; copy newest bodies, do not revert.
- `supabase/migrations/0127*` `private.session_limits_config` / `session_limit()` -- add `disclosure_answer_business_days`.
- `0138`/`0139` `get_support_accounts`, `assign_support` -- exemplar for AAL2 Super Admin read functions and audit rows.
- `apps/dashboard/services/payments.ts:550-588`, `payments.ledger.ts:113-142,239-286`, `members.detail.ts:117-140`, `auditLog.ts:126-239` + `audit/` page and `auditLabels.ts` -- actor resolution, proxy mapping, Owner "request disclosure" action, epic23 label test.
- `apps/mobile/src/services/payments.ts:111-161`, `(tabs)/history/payment/[id].tsx:161`, locales `paymentDetail.actorLabel`/`unknownActor` -- member-side rule.
- `apps/super-admin/app/(admin)/support/` (`actions.ts` pattern, `authorizeOrRedirect`), `gyms/[id]/components/AuditTrailTab.tsx` + `services/gyms.ts:283-296` -- real-person view and disclosure inbox.
- Not yet traced: notifications (0045/0046/0084), check-ins (`attendance.ts`), error logging. Trace them while writing the per-surface tests.
- Tests to extend: `supabase/tests/support_proxy_actor.test.sql` (writer scan 208-240), `support_capabilities.test.sql`, `audit_log_immutable.test.sql`.
- `packages/types/src/database.ts`, `docs/decisions.md`, `deferred-work.md` (close lines naming 23-8: 1334, 1351-1352, 1369), `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0142_support_action_identity.sql` -- table, `private.record_support_identity()`, hooks in `log_audit_event`, payments/refunds AFTER INSERT triggers and the three non-trigger writers, Super Admin read function, disclosure request table + file/answer/list functions, config key -- accountability and disclosure
- [x] `scripts/rollback-0142-support-action-identity.sql` -- restore bodies, drop objects
- [x] `supabase/tests/support_action_identity.test.sql` -- I/O rows, identity-row-or-fail, per-DB-surface hiding as Owner/Supervisor/Manager, disclosure rules, config read, writer scan extended and shown to fail on seeded bad input
- [x] dashboard services/UI -- proxy mapped to "GymOS Support"; Owner disclosure request on an audit row; EN/FR; unit tests incl. per-surface leak tests
- [x] mobile payment detail + receipts/templates -- gym instead of a person; EN/FR; tests
- [x] super-admin -- real-person audit view and disclosure inbox/answer at AAL2; tests
- [x] types, decisions.md (incl. historic-row check result), deferred-work, sprint-status

**Acceptance Criteria:**
- Given a gate or writer scan, when a new support-capable writer skips identity recording, then CI fails (retro 66).
- Given the 23-8 deferrals naming it in deferred-work.md, when the story closes, then each is closed or moved into criteria (retro 67).
- Given `scripts/ci-local.sh`, when it runs, then every stage is green (read per-stage lines; scan shown capable of failing).

## Implementation Notes

## Spec Change Log

## Review Triage Log

Round 1, layers: blind-hunter, edge-case-hunter, verification-gap.
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Dashboard leak test never seeds the real person, so assertNoRealPerson cannot fail | medium | patch | Reviewer read the file: fixtures hold only proxy/staff. |
| Waived-by (`getMemberRegistrationFeeState`) has no proxy-actor test; members.detail "unconverted" | low | patch | It falls back to `actor_display_name`, so it shows "GymOS Support" today; only the pin is missing. |
| `resolveActorNames` RPC error fails payments ledger/pending/refund lists | medium | patch | Callers propagate `error`; lists previously needed no extra call. |
| Inbox failure turns the whole support page into LoadError | low | patch | `page.tsx:24` ORs `inbox.error`. |
| Owner request panel shows only a uuid prefix; button shown on rows with an open request | low | defer | Real usability gap, not a leak; filed in deferred-work. |
| Inbox shows no Owner contact for delivering the answer | low | defer | Owner contact is on the gym detail page; filed. |
| `get_support_action_identity` read is not audited | low | defer | Not required by the spec; filed for 23-10. |
| Answer free text could carry a real name into the gym UI | low | defer | Super Admin-authored; add authoring guidance/screen when support is enabled. |
| `record_support_identity` callable to forge rows | false | rejected | It lives in `private`, which PostgREST does not expose; only definer/trigger code calls it. |
| UPDATE paths of actor columns leave no identity row | false | rejected | 0140 pins actor_id on payments update; refunds has no UPDATE path; dismissed_by is covered. |
| Inbox/answer lack `is_super_admin_live()` | false | rejected | `support_admin_required()` already demands Super Admin at AAL2. |
| Message templates / payment detail screen unconverted | false | rejected | Detail screen renders `getPaymentReceipt`'s actorName; recon found no edge function using actor_id. |
| unique_violation race, suspended-gym raise, double submit, shared message state, pagination, UTC weekends, French label, rollback deletes identity, label string match on gym page, add_business_days IMMUTABLE | low | rejected | Cosmetic or needs contrived concurrency; fix adds branches for no named user harm. |
| Dialog/page wiring and refund-trigger end-to-end tests missing | low | rejected | Pieces are covered; scan covers the trigger bodies. |
| Spec tasks unchecked, logs empty | false | rejected | Fix edits the spec under review; ticks already applied. |

## Design Notes

Decisions made without the owner (not user-visible choices): member side shows the gym name where a person would appear (FR-195 wording); the Super Admin answer is free text stored with the request, delivery outside the product. Payments/refunds use an AFTER INSERT sibling trigger because the BEFORE trigger lacks the final row id.

## Verification

**Commands:**
- `scripts/pgtap-run.sh supabase/tests/support_action_identity.test.sql supabase/tests/support_proxy_actor.test.sql supabase/tests/support_capabilities.test.sql` -- expected: all ok
- `node scripts/check-migration-guardrails.mjs` -- expected: clean
- `bash scripts/ci-local.sh` -- expected: GREEN on all stages
