---
title: '23-9 Support connects the payment account'
type: 'feature'
created: '2026-10-21'
status: 'in-progress'
baseline_commit: '3500c7064ee2c8e56339390330458cacd2356484'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only an Owner can connect Tara Money (`connect_gym_payment_credentials`). Support cannot do it for a gym, and a replacement overwrites the single credential row in place, so an in-flight payment can no longer be verified under the credential it started with.

**Approach:** Add an audited, step-up-gated support function that connects or replaces a gym's credentials. Replacement retires the old row and inserts a new active one; payments record `credentials_id` at initiation and are verified under it. Notify the Owner and Super Admin on every change, and clean up retired secrets with a job.

## Boundaries & Constraints

**Always:** Gate on live support assignment (`private.support_gym_id()`), step-up action `support_payment_connection` with subject `gym_id::text`, consumed through `private.support_stepup_require`; the stored actor is `private.actor_id()` (the proxy) and `private.record_support_identity('gym_payment_credentials', …)` is called. Keep the 0083 platform business-id collision guard. Audit rows record that credentials changed, never a value. Unique constraints become partial over active rows (`retired_at is null`). The webhook returns 401 before any write for an unknown or deleted credential. Add `payment_connection` rows to `private.support_capabilities` and keep the catalog test green. Bilingual EN/FR Owner text. Migration numbered 0143 with a rollback script. Owner path keeps working, using the same retire-and-insert logic.

**Decisions (owner, 2026-10-21):** Notifications use one in-app notices table (`staff_notices`: recipient user, gym, type, EN/FR title and body, `read_at`) with a bell and unread count in the dashboard header (Owner) and the Super Admin app header (every Super Admin). A payment-connection change writes one Owner notice and one notice per Super Admin; the text names no individual and holds no credential value. Major alerts (payment-connection changes) are also delivered by email through Resend (already configured in Vercel) via a delivery queue drained by a worker, so a failed send never rolls back the change and is retried and recorded. SMS stays off until a provider is chosen; no paid add-on without an explicit yes. Support connects through the existing dashboard Settings payment form, shown to a live support session.

**Never:** No Owner approval step (AD-36 dropped). No credential value in audit, notification, error or log. No in-place `vault.update_secret` on a secret still referenced by a pending/processing payment. Do not delete retired secrets inside the connect call. Do not enable support for any gym.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First connect | Live support, valid step-up, no row | Active row, Vault secret, masked id, Owner notified, Super Admin alerted, audit row | N/A |
| Replace | Active row exists | Old row `retired_at` set (kept), new active row; `connected_at` of the new row anchors reconciliation | N/A |
| Roll back to earlier merchant | Retired row has same business id | New active row (new secret), partial unique allows it | N/A |
| No/used step-up | Missing, expired or reused | Refuses, no write | `step_up_required` |
| Platform id collision | Business id equals platform id | Refuses (0083 guard) | existing message |
| Pre-swap payment | Webhook/status/reconcile after swap | Verified under `payments.credentials_id` | Retired credential still resolves |
| Deleted credential | Webhook for deleted secret | 401, no DB write | N/A |
| Cleanup | Retired, nothing pending/processing under it, ≥7 days (cap 14) | Secret deleted from Vault, `job_runs` row | Failure recorded, retried next run |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0142_support_action_identity.sql:89-228` -- latest `connect_gym_payment_credentials` (Owner only, in-place `vault.update_secret`); base for the shared logic and new support RPC.
- `supabase/migrations/0052_gym_payment_credentials.sql:16-27`, `0054_flow_a_gym_routing.sql:20-32` -- `unique (gym_id, provider_key)` and `idx_gym_payment_credentials_provider_business_id`; both become partial on `retired_at is null`.
- `supabase/migrations/0083_platform_business_id_collision_guard.sql` -- collision guard to keep.
- `supabase/migrations/0127_*.sql:26-41`, `0140:96-126,140` -- `private.support_stepup`, `stepup_issue` allow-list (add `support_payment_connection`), `support_stepup_require`; copy `waive_registration_fee` (0140:~340-360).
- `supabase/migrations/0140:25-66` and `tests/support_capabilities.test.sql` (bump `plan`) -- capability rows.
- `supabase/migrations/0141:351,449` -- `initiate_registration_fee_payment`, `initiate_session_payment`: record `credentials_id`; add column and backfill on `payments`.
- `0054:~353`, `0070:65`, `0076:200` -- reconciliation joins on `(gym_id, provider_key)` with `created_at >= connected_at`: change to `credentials_id`.
- `0054:169-227` -- `get_gym_payment_credentials_for_service`, `_by_business_id`, `mark_…_needs_attention`: resolve by credential id, keep retired rows resolvable for in-flight payments.
- `supabase/functions/payment-webhook/index.ts:268-320,499-510,652`, `_shared/payment-providers/TaraMoneyProvider.ts:200-235,324,458-540` -- pass `credentials_id`; 401 path stays before writes.
- `0124:1459` `disconnect_gym_payment_credentials` -- decide retire vs delete; must not hard-delete a row with pending payments.
- `0032:184`, `0120:198-205`, `0133:104` -- cron, `job_runs` and failure-survival patterns for `payment_connection_cleanup`.
- `0142:311` `get_support_action_identity` -- widen reader to payment, refund, credential rows (deferred from 23-8).
- `apps/dashboard/services/gym-payment-credentials.ts`, `app/(dashboard)/settings/actions.ts:164-210` -- UI wrapper/action; EN/FR strings.
- `supabase/tests/gym_payment_credentials_rls.test.sql`, `support_action_identity.test.sql` -- pgTAP models.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0143_support_payment_connection.sql` -- `retired_at`, partial uniques, `payments.credentials_id` + backfill, support connect function, `stepup_issue` value, capability rows, lookup functions by credential id, cleanup function + cron, `staff_notices` + email delivery queue -- AD-37
- [ ] `supabase/migrations/…` rollback script `scripts/rollback-0143-*.sql` -- reversible
- [ ] initiate/reconcile/webhook code paths (above) -- verify under `credentials_id`
- [ ] `supabase/tests/support_payment_connection.test.sql` -- step-up refusal, retire/rollback, collision guard, proxy `connected_by` and one identity row (23-7/23-8 deferrals), pre-swap payment verification, cleanup rules, audit holds no value
- [ ] `supabase/functions/payment-webhook/index.test.ts` -- deleted credential gives 401 before writes
- [ ] Settings payment form for live support, `staff_notices` bell in dashboard and Super Admin headers, Resend worker (queue drain, retry, `job_runs`), services, tests and EN/FR copy
- [ ] widen `get_support_action_identity` reader to proxy-keyed rows
- [ ] a scan that fails when a payment initiator or credential lookup skips `credentials_id` (every consumer listed above)

**Acceptance Criteria:**
- Given any item in the I/O matrix, the behavior matches.
- Given the epic 23.9 criteria in `epics.md`, each has a named test.
- `bash scripts/ci-local.sh` is green.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

`stepup_issue` only accepts listed actions and support ones must start `support_`, so the epic's `payment_connection` is stored as `support_payment_connection`. Replacement must not bump a shared row in place: the old reconciliation anchor `connected_at` lives on each row, so a new row gets its own anchor.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN, every stage PASS
- `bash scripts/ci-local.selftest.sh` -- only if ci-local.sh changes
