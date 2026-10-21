---
title: '23-7 Hidden Identity: Per-Gym Proxy Actor'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: 'f16c5f7f9a26e6091f4044bcccd1680189b7263e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every actor column written by an allow-listed RPC for a live support session holds the real person's `users.id` (`auth.uid()`), so an Owner reading `payments.actor_id`, `refunds.actor_id` or `audit_log.actor_id` can identify and correlate the person across gyms (FR-186, AD-39). `refunds.actor_id` and `payments.actor_id` on direct inserts are even client-supplied.

**Approach:** One migration gives every gym a proxy `users` row backed by a banned `auth.users` row (trigger on gym insert, backfill of existing gyms in the same migration), adds `private.actor_id()` (proxy for a live support session, else `auth.uid()`), switches every actor-writing function to it, forces the server-derived actor on direct payment/refund inserts, and adds a generated catalog test that fails on any unlisted writer or unclassified user-FK column.

## Boundaries & Constraints

**Always:**
- `private.actor_id()` resolves the proxy only through `private.support_gym_id()` (live support); for any other caller it returns `auth.uid()`, so non-support behavior is unchanged.
- Proxy: `users.is_support_proxy` true, `display_name = 'GymOS Support'`, null phone and email, one per gym (unique), banned `auth.users` row, no `members` row, never signable-in. Gym insert fails closed if the proxy cannot be created.
- `log_audit_event` writes `actor_display_name = 'GymOS Support'` and the proxy id for a live support caller.
- Writers to convert (from the live catalog): `log_audit_event`, `confirm_renewal`, `initiate_registration_fee_payment`, `initiate_session_payment`, `record_registration_fee`, `record_session_payment`, `connect_gym_payment_credentials` (`connected_by`), `update_messaging_instance` (`updated_by`), `front_desk_alerts_protect_columns` (`dismissed_by`). BEFORE INSERT triggers on `payments` and `refunds` set `actor_id := private.actor_id()` for a live support caller (client value ignored).
- Retro 66 (gates reach consumers): a pgTAP scan over `pg_proc` bodies and triggers lists every function that writes `auth.uid()` into a column; each must call `private.actor_id()` or sit in a named exemption list with a reason (Super Admin action, member self-check, coach/own-row, identity comparison, support lifecycle). Another scan classifies every column with an FK to `users` as actor or non-actor. An unlisted one fails CI; both shown to fail on a seeded bad case.
- Gym-side reads: no policy on `users` or `members` returns a support person's or proxy's row to a gym role (raw reads included); the proxy is excluded by `is_support_proxy` from any `users`-based list or count.
- Same person in two gyms gets two unrelated proxy ids.
- Rollback script; guardrails clean; local only, not applied to production.

**Never:**
- No `support_action_identity` table or Super Admin read (23-8). No name rendering for "recorded by" (the proxy has no `members` row, so those screens show no name until 23-8 resolves "GymOS Support"). No member-facing surface changes (23-8). No payment connection flow (23-9). No dashboard code.
- Do not enable support for any gym before 23-8 ships (recorded in decisions.md).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| New gym | insert into `gyms` | one proxy `users` + banned `auth.users` row exists | trigger error rolls back the gym |
| Backfill | existing gyms without proxy | each gets exactly one; re-run adds none | N/A |
| Support write | live support records a payment, refund, audit event | actor columns hold the gym's proxy id; display name 'GymOS Support' | N/A |
| Direct insert | support inserts refund with `actor_id` = real id | stored actor is the proxy id | N/A |
| Non-support | owner/manager/receptionist writes | actor is `auth.uid()` as before | N/A |
| Two gyms | one person live in gyms A and B | two different proxy ids, none equal the real id | N/A |
| Unlisted writer | new function writes `auth.uid()` into a column | catalog test fails | CI red |
| Gym-side read | owner selects `users`/`members` for support or proxy | zero rows | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0140_support_capability_allow_list.sql` -- latest bodies of `log_audit_event` (~188-230), `record_registration_fee` (~408), `record_session_payment` (~815), `renew_subscription`/`confirm_renewal` (~1030), `support_gym_id()` use. Copy the newest prior body of each function from `pg_proc`/migrations; do not revert 0140 changes. Next migration 0141.
- `initiate_registration_fee_payment`, `initiate_session_payment`, `connect_gym_payment_credentials` (0052/0054/0083), `update_messaging_instance`, `front_desk_alerts_protect_columns` -- find latest definitions with `\sf` on the local DB before rewriting.
- `handle_new_user` trigger -- creates `public.users` for each `auth.users` insert; the proxy trigger must cooperate with it. `supabase/migrations/0135:134-205` `support_gym_id()`, `support_live`. `0139` (2 DB functions already delete `auth.users`, precedent for SQL-side auth writes).
- `supabase/migrations/0033*` refunds (`actor_id not null references users`), payments `actor_id` nullable; no policy pins either today (policies do not mention `actor_id`). Existing triggers on both: add new `aa_`-style BEFORE INSERT trigger last-to-run semantics matching `aa_guard_support_refund_stepup` (0140).
- `apps/super-admin/app/(admin)/gyms/actions.ts` + `services/gyms.ts` `insertGym` -- gym creation path (service role); must still succeed, no code change expected.
- Tests to copy: `supabase/tests/support_capabilities.test.sql` (live support claims helper, catalog scans), `support_role_live_gate.test.sql`.
- `packages/types/src/database.ts` (`users.is_support_proxy`), `docs/decisions.md`, `deferred-work.md` (close lines naming 23-7; the 23-6 audit-actor line), `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0141_support_proxy_actor.sql` -- `users.is_support_proxy` + unique-per-gym link, gym-insert trigger, backfill, `private.actor_id()`, converted writers, payment/refund actor triggers, `users`/`members` hiding checks
- [x] `scripts/rollback-0141-support-proxy-actor.sql` -- restore replaced bodies, drop triggers and column, remove proxy rows
- [x] `supabase/tests/support_proxy_actor.test.sql` -- all I/O rows, writer scan, user-FK column scan, two-gym unrelated ids, gym-side hiding, scans shown to fail on seeded bad input
- [x] existing pgTAP files that list users columns or function inventories -- update only if they now fail
- [x] types, `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml`

**Acceptance Criteria:**
- Given gym creation, when the proxy cannot be created, then the gym insert fails and nothing is left behind.
- Given any function body or trigger that writes `auth.uid()` into a column, when CI runs, then it calls `private.actor_id()` or is a listed exemption; an unlisted one fails.
- Given a live support session in two gyms, when it writes in each, then the actor ids differ and neither is the real user id.
- Given `scripts/ci-local.sh`, when it runs, then every stage is green (read per-stage lines).

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

A DB trigger (not the Admin API) creates the banned `auth.users` row: it is atomic with the gym insert, fails closed by construction, and the backfill is a plain migration step, so no separate script can be forgotten. 23-5 already deletes `auth.users` from SQL. The proxy has no `members` row so it can never be counted or listed; the cost is that name lookups through `members` return nothing until 23-8.

## Verification

**Commands:**
- `scripts/pgtap-run.sh supabase/tests/support_proxy_actor.test.sql supabase/tests/support_capabilities.test.sql supabase/tests/support_role_live_gate.test.sql` -- expected: all ok
- `node scripts/check-migration-guardrails.mjs` -- expected: clean
- `bash scripts/ci-local.sh` -- expected: GREEN on all stages (read per-stage lines)

### Review Triage Log (round 1)

Layers: blind-hunter, edge-case-hunter, verification-gap.
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `actor_id()` falls back to `auth.uid()` when a live support gym has no proxy (fail-open) | medium | patch | `coalesce(proxy, auth.uid())`; raise instead; test added. |
| `banned_until = 'infinity'` may break GoTrue admin `listUsers` | medium | patch | `findUserByEmail` pages `listUsers`; use a finite far-future date. |
| `hide_support_membership` allowed branches and UPDATE/DELETE claim untested | medium | patch | Dropping either branch passes every assertion. |
| Docs: "three" vs four test files; sprint-status lacks verification evidence | low | patch | Direct correction. |
| Four converted writers verified by source text only (`connect_gym_payment_credentials`, `update_messaging_instance`, `front_desk_alerts_protect_columns`, `initiate_*`) | low | defer | Unreachable by support today; 23-9 adds a behavioral assertion when it opens the connection function. |
| Gym delete cascades the proxy `users` row; audit/payment FKs and orphan `auth.users` | low | defer | No gym-delete path with data today; already in deferred-work. |
| Support UPDATE of `payments.actor_id` / `refunds.actor_id` not covered by the insert trigger | false | rejected | `protect_payment_columns_on_staff_verify` (0140) pins `actor_id`; `refunds` has no UPDATE policy except the gate. |
| `ensure_support_proxy` select-then-insert race | low | rejected | Runs once per gym insert and once in the migration; no concurrent caller exists. |
| Dependence on `handle_new_user`; `front_desk_alerts_protect_columns` not definer so needs `actor_id()` execute; `log_audit_event` with null gym for support | low | rejected | Function raises if the users row is missing; the only updating role is `authenticated`, which has execute; null-gym audit is the Supervisor behavior (23-8). |
| Writer scan satisfied by a mention or missing indirect helpers; user-FK scan blind to non-FK columns; hard-coded 'GymOS Support'; `update_messaging_instance` classification; `is_super_admin` vs live; proxy "excluded from users lists" has no filter; rollback orphan proxies; proxy sign-in flows untested | low | rejected | Heuristic limits are recorded in decisions.md; the proxy is banned and `users` is self-read only; remaining are cosmetic. |
