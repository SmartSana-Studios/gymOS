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

### Review Findings

Round 2 (2026-10-21), layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor.

- [x] [Review][Decision] (resolved: add a scan; done as D3 in support_proxy_actor.test.sql) Frozen constraint "proxy excluded by `is_support_proxy` from any `users`-based list or count" has no filter and no test — the repo reads `users` only by key today (no list or count found; `list_super_admins` is excluded by the proxy-not-super-admin check), so the constraint holds by absence. Options: (1) add a catalog or code scan that fails on a new `users` list or count lacking the filter; (2) accept holding-by-absence and record it in decisions.md; (3) renegotiate the frozen block.
- [x] [Review][Patch] `protect_self_managed_user_columns` (0015/0019) does not pin the new `users.is_support_proxy` and `support_proxy_gym_id`, so a user can self-update them; the unique-per-gym index and the proxy-gym CHECK limit the impact today. Pin both columns and add a self-update pgTAP case [supabase/migrations/0141_support_proxy_actor.sql:22]
- [x] [Review][Patch] Writer scan regexes miss the `(select auth.uid())` idiom (`:= (select auth.uid())`, `set x = (select auth.uid())`, `select auth.uid() from`); also plain `x = auth.uid();` plpgsql assignment and `default auth.uid()` in DECLARE; no current writer uses it, so the gate is latent-blind [supabase/tests/support_proxy_actor.test.sql:222]
- [x] [Review][Patch] Tautological or dead test code: `user_fk_cols()` case with identical branches; "payments, refunds and audit actors are converted" counts the test's own fixture; `zz_good_compare` control never asserted [supabase/tests/support_proxy_actor.test.sql:268]
- [x] [Review][Patch] Doc nits: migration header says "banned forever" but the code bans until 2999-12-31; unbalanced parenthesis in the decisions.md 23-7 entry; gym-delete cascade item listed twice in deferred-work.md [supabase/migrations/0141_support_proxy_actor.sql:6]
- [x] [Review][Defer] Existing `payments`/`refunds`/`audit_log` rows may already hold a support person's real `users.id` (written under 0140) — deferred: unverified medium; settle with a prod query that joins those actor columns to support `members`, and record the result before 23-8 enables support
- [x] [Review][Defer] Raw `auth.users` insert leaves `confirmation_token`, `recovery_token`, `email_change` NULL; GoTrue admin `listUsers`/`findUserByEmail` could fail on some versions — deferred: unverified medium; settle by running the real admin API (listUsers, createUser, recovery) against a local DB holding proxies, before the master merge
- [x] [Review][Defer] Non-support direct inserts into `payments`/`refunds` still accept a client-supplied `actor_id` — deferred: pre-existing, already recorded
- [x] [Review][Defer] Writers `connect_gym_payment_credentials`, `update_messaging_instance`, `front_desk_alerts_protect_columns`, `initiate_*` verified by source text only — deferred: already in round 1, due in 23-9

Rejected:
- Edge Case Hunter (arrived after the first triage): `hide_support_membership` NULL role: false, `members.role` is NOT NULL. Live-vs-JWT Super Admin check in the policy: matches the other policies. INSERT-only `aa_support_force_actor`: 0140 pins `actor_id` on update and `refunds` has no UPDATE path. Rollback FK to other user columns: the converted writers are the only proxy writers. Non-FK actor columns, unmarked rollback orphans, sign-in untested, listUsers paging: already covered above or low.
- Writer scan satisfied by an unrelated `private.actor_id()` mention / blind to helpers and non-FK columns: accepted limitation recorded in decisions.md (round 1).
- `hide_support_membership` outside the Code Map: needed to meet the "no policy returns a support row" constraint; consequences (four older tests) are documented.
- New `users` columns client-writable: false. The consistency CHECK, unique index and proxy-not-super-admin check block a self-update (tests at lines 76-79); a self-set `display_name` is cosmetic because `log_audit_event` writes the literal.
- Rollback UPDATEs on `audit_log` could be blocked: false. 0007 revokes from roles only and defines no trigger; rollback runs as owner and was rehearsed. Unmarked retained proxies: low, documented in the script header.
- `actor_id()` returns the real id for a non-live support caller: non-live support cannot write (round 1).
- Proxy sign-in untested, other-role hiding untested, hard-coded literal, `update_messaging_instance` classification: low, fix adds tests or complexity for no named harm.
- Spec status/triage-heading bookkeeping: fix edits the spec under review.
