---
title: '20-1 Loyalty program setting and ledger foundation'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '965b28a0f087f76aa4a4941169a74817e9b45333'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 20's loyalty rules (20.2-20.4) and screens (20.5-20.6) need a per-gym program setting, a tamper-proof event ledger, derived progress and one read function, none of which exist (FR-164, FR-170, NFR-022, FR-168 read rule).

**Approach:** Migration 0117 adds four pinned `gyms` columns with one audited setter RPC, the append-only `loyalty_events` ledger, the derived `loyalty_progress` table, the FK from `guest_sessions.loyalty_grant_id` to the reward event, and the read-only `effective_loyalty()`. Nothing awards anything yet and no gym changes behavior.

## Boundaries & Constraints

**Always:**
- Number is **0117**. `gyms` gains `loyalty_enabled boolean not null default false`, `loyalty_guest_threshold` N (CHECK 2-50), `loyalty_renewal_threshold` K (3-24), `loyalty_reward_days` R (1-30); N/K/R nullable, and CHECK requires all three non-null when enabled. Every existing gym is off.
- `set_loyalty_program(p_enabled, p_n, p_k, p_r)`: SECURITY DEFINER, `search_path` pinned, role via `private.current_member_role()` in (owner, supervisor) (never JWT `app_role`), gym from `private.gym_id()`, suspension-aware (`private.current_gym_status() is distinct from 'active'` raises), one `log_audit_event('loyalty_program_changed')` with old and new of all four values, an unchanged call writes nothing and logs nothing. Enabling requires N, K, R non-null and in range (typed `invalid_value` error); disabling ignores N/K/R and keeps stored values.
- The four columns are pinned by **their own** BEFORE UPDATE OF trigger function with its own GUC (`app.loyalty_program_update_bypass`), no super-admin or service_role exemption, not a branch of `protect_super_admin_only_gym_columns()` and not 0107's charging pin.
- `loyalty_events` columns: `id`, `gym_id`, `member_id`, `event_type` in (`stamp_earned`,`reward_granted`,`reward_consumed`,`reset`,`lapse`,`stamp_reversed`), `counter` in (`guest`,`subscriber`), `origin_id uuid not null`, `occurred_at`, `details jsonb`; unique `(origin_id, event_type)`. `loyalty_progress`: one row per `(gym_id, member_id)` with `guest_stamps`, `subscriber_stamps` (>= 0), `guest_last_event_at`, `subscriber_last_event_at`.
- Both tables: RLS on; SELECT for staff of the gym (owner, manager, supervisor, receptionist) and the member on their own rows; no INSERT/UPDATE/DELETE policy; grants limited to SELECT for `authenticated` and `service_role` (revoke all first, TRUNCATE included); restrictive `tenant_active_gate` like 0107.
- `guest_sessions.loyalty_grant_id` gets an FK to the `loyalty_events` row that must be `reward_granted`: unique `(id, event_type)` on the ledger, a generated `loyalty_grant_event_type` on `guest_sessions`, composite FK.
- `effective_loyalty(p_member_id uuid) returns jsonb`: STABLE, SECURITY DEFINER with explicit authorization (own member row, or staff roles above of that member's gym); never writes. Fields: `enabled`, `guest_stamps`, `subscriber_stamps` with the idle window applied at read time (guest: `loyalty_idle_reset_days`; subscriber: greatest of that and current plan `duration_days` + gym `grace_period_days`; counter reads 0 when its last event is older), `guest_threshold`, `renewal_threshold`, `reward_days`, window days, `free_sessions` (unused, unvoided, `usable_until > now()`, with `usable_until`) and `paid_sessions` likewise. Gym suspended: returns null.
- Windows come from `platform_session_config`, never literals. Suspended-gym denial, cross-gym isolation and 19.1 lint (no `auth.jwt()` role reads) hold. Function privileges: revoke from public/anon, grant authenticated.
- pgTAP positive + `.negative` files, regenerated `packages/types/src/database.ts` (hand splice), `scripts/rollback-0117-*.sql`, EN/FR dashboard audit label for `loyalty_program_changed`.

**Never:** No stamp, grant, reset or lapse logic (20.2-20.4), no hook bodies, no dashboard or mobile UI, no cron job, no manual balance write path for any role, no `ADD COLUMN ... DEFAULT true`, no new Edge Function.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enable, valid | owner, (true,5,6,7) | columns set, one audit row old/new | N/A |
| Enable, missing/out of range | (true,null,6,7) or N=1 | refused, nothing changes | `invalid_value` |
| Disable | (false,null,null,null) | switch off, N/K/R kept | N/A |
| Unchanged | same values | no write, no audit | N/A |
| Wrong role / other gym | manager, receptionist, member | refused | `permission denied` |
| Suspended gym | owner | refused | not active |
| Direct UPDATE | authenticated or service_role on the four columns | silently reverted | N/A |
| Ledger write | any client role | refused (no grant) | 42501 |
| Duplicate event | same (origin_id, event_type) twice | second insert fails | unique violation |
| Past window | last guest event 91 days ago | `guest_stamps` 0 in `effective_loyalty` | N/A |
| Subscriber window | plan 365 days, grace 3, last event 200 days ago | counter still live (window 368) | N/A |
| Other member / gym | member reads another member, staff reads other gym | refused | `permission denied` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0107_charge_guests_setting_session_record.sql` -- model: pin trigger, `set_guest_charging`, `guest_sessions` RLS/grant/tenant gate shape, `platform_session_config`
- `supabase/migrations/0007_audit_log.sql` -- `log_audit_event`; append-only revoke pattern for the ledger
- `supabase/migrations/0116_session_alert_cooldown.sql` -- latest; 0117 follows it
- `supabase/tests/charge_guests_setting.test.sql`, `.negative.test.sql` -- fixture and `plan()` conventions to mirror; `suspension_rpc_coverage.test.sql` and 11.8 coverage test pin the ungated table set / RPC list, check they need the new objects
- `scripts/check-migration-guardrails.mjs`, `scripts/rollback-0116-*.sql` -- lint gate and rollback shape
- `packages/types/src/database.ts` -- add `loyalty_events`, `loyalty_progress`, new `gyms` columns, two functions, `guest_sessions` FK
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`, `auditLabels.epic19.test.ts`, `locales/en.json`, `fr.json` -- add `loyalty_program_changed` label (new epic20 test file)
- Do not touch: `consume_guest_session`, `on_session_*` hooks, `complete_verified_payment`, 0107 charging pin

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0117_loyalty_program_ledger_foundation.sql` -- columns, pin, setter, ledger, progress, FK, `effective_loyalty` -- the whole data foundation
- [ ] `supabase/tests/loyalty_foundation.test.sql`, `loyalty_foundation.negative.test.sql` -- positive paths, pins, windows, isolation, denials, suspension, FK type check
- [ ] `scripts/rollback-0117-loyalty-program-ledger-foundation.sql` -- drop in reverse order with verify
- [ ] `packages/types/src/database.ts` -- splice new types
- [ ] dashboard audit label + EN/FR strings + `auditLabels.epic20.test.ts`
- [ ] local gates: apply migration to local DB, `scripts/ci-local.sh` all stages; sprint-status entry

**Acceptance Criteria:**
- Given the matrix cases, when pgTAP and vitest run, then all pass and `scripts/ci-local.sh` is green on every stage.
- Given two gyms, when each side's staff and a two-gym member read, then each sees only that gym's rows.
- Given a rolled-back transaction on local DB, when 0117 and its rollback run, then the schema returns to its pre-0117 state.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Session lists: consumed/expired/voided-free/other-gym fixtures unasserted (VG) | medium | Query filters exist but no fixture fails if dropped. patch: tests |
| 2 | Subscriber window floor and latest-subscription choice unpinned (VG) | medium | Only 365-day and null cases tested. patch: tests |
| 3 | tenant_active_gate on new tables counted, never exercised (VG, BH) | medium | Only the 23 -> 25 count asserts it. patch: tests |
| 4 | Staff roles manager/supervisor/receptionist not positively read (VG) | low | patch: tests (cheap, same file) |
| 5 | Existing guest_sessions rows could break the FK; no pre-check, no lock_timeout, misleading "backfill" wording (BH, EC) | low | No migration writes loyalty_grant_id (grep: only 0107 column, 0114 read), so no prod row can hold one; message and lock_timeout are cheap. patch: precheck + `set local lock_timeout` + wording |
| 6 | Header says "pinned against every direct write" / "nothing reads" (EC, BH) | low | INSERT deliberately unpinned as 0107 (clients never granted gym INSERT). patch: comment |
| 7 | Rollback destroys ledger without guard; verify matches proname without schema (EC, BH) | low | patch: refuse when loyalty rows or grants exist; schema filter |
| 8 | Stale "no FK yet" test comments (EC, BH) | low | patch: comment |
| 9 | platform_session_config empty/null; grace NULL (EC, BH) | false | singleton row, NOT NULL CHECK > 0, no INSERT/DELETE grant; gyms.grace_period_days is NOT NULL default 3 (0002:22) |
| 10 | Latest subscription may be a dead plan (EC) | false | subscription_status has no cancelled/pending; latest row is the current plan, same rule as guest_charging_impact() |
| 11 | No composite (member, gym) FK (EC, BH) | false | Same shape as guest_sessions, payments; writers are definer functions (20.2+); no new harm |
| 12 | No ON DELETE; member/gym delete fails (EC) | false | Only hard member delete is compensating cleanup of a just-created member (members.ts:725) with no ledger rows; same FK posture as guest_sessions |
| 13 | No index on guest_sessions(loyalty_grant_id) (EC) | false | Ledger rows are never deleted; no scan is triggered |
| 14 | INSERT not pinned (EC claim) | false | See 6; deliberate, 0107 precedent |
| 15 | set_loyalty_program with gym row missing (EC) | false | role check reads members row of a gym that FK-exists |
| 16 | Stamps may exceed lowered threshold (EC) | false | Intended by FR-164 (reward at next qualifying event, nothing erased); 20.2 awards |
| 17 | No immutability trigger on ledger (EC, BH) | low, rejected | Story AC says "revoked like audit_log" and audit_log has no trigger; fix adds complexity |
| 18 | event_type/counter pairing CHECK, progress last_event CHECK (EC) | low, rejected | Speculative before writers exist (20.2+) |
| 19 | Bare Json return, no shared TS type (BH) | low, rejected | Consumers are 20.5/20.6; spec Never lists UI |
| 20 | Disable path ignores garbage args (BH) | false | Spec: disabling ignores N/K/R |
| 21 | mk_grant helper copy-pasted; locale test fragility; no concurrency test (BH) | low, rejected | Fix larger than benefit |

## Design Notes

`effective_loyalty` returns `jsonb` (an object, never a SQL NULL composite, so the PostgREST 14 all-null-row trap from Epic 19 does not apply; a suspended gym returns JSON null which clients treat as "no loyalty"). Definer is required because `platform_session_config` is Super Admin read only. Coaches are excluded from the staff list to match `guest_sessions` SELECT policies; widen later with a policy change if the coach portal needs it.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` (or `scripts/ci-local.sh --fast`) -- expected: all pgTAP files pass, guardrails clean
- `scripts/ci-local.sh` -- expected: typecheck, lint, i18n parity, vitest, pgTAP, E2E green
