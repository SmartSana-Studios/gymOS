# V1.6 (Epic 19) staged production deploy

Status: **stages 1a (0106-0109), 1b (0110) and 2 (0111-0114, 0116) APPLIED to production 2026-10-12** (head 0116; 1a ~13:15 UTC, 1b ~17:10, stage 2 ~17:50, each after a rolled-back dry run and a green db-backup run; charging on for 0 gyms, anon EXECUTE false, direct client writes on attendance_events/class_bookings.attended_at revoked). **The 7-day soak on 0110 was deliberately overridden by the owner on 2026-10-12** after a live alert test (alert raised, dismissed, no duplicate; member in good standing checked in). **Not applied: 0115 (stage 3, gated).** PR #52 merges next.

Production has live gyms. Everything V1.6 is off per gym until an Owner/Supervisor enables it, so the risk is in the *plumbing* migrations (0106-0110 touch live payment/alert paths) and in ordering the dashboard deploy after the schema it queries.

## Why the PR cannot simply merge first
Merging to `master` auto-deploys the dashboard (Vercel Git integration). The epic's dashboard code queries objects that do not exist in production until the migrations are applied (`front_desk_alerts.kind`, `session_attempts`, `guest_sessions`, the Guest sessions RPCs). **Merge #52 only after stage 2 below is applied.**

## Gates, every stage (runbook rules a-d)
1. Trigger `db-backup` (`workflow_dispatch`) and confirm the run **green immediately before** the stage.
2. **Rehearsed**: `node scripts/prod-apply.mjs <stage> --dry-run` runs the stage's migrations and the verification queries inside ONE transaction on production and rolls it back (nothing persists; table locks are held for seconds). A restore of the latest R2 dump into a local Supabase (age key is the owner's) is the other rehearsal and is what closes the runbook's "last tested restore: never" line in section 3.
3. Preflight (`scripts/preflight-v16-stage1.sql`, read-only): no STOP lines.
4. CI green on the merge commit: `scripts/ci-local.sh` was green for the epic head (see the PR).
5. Apply with the per-stage deploy script (host psql, one transaction per migration, ledger row in the same transaction). Never `supabase db push`.

## Stages
| Stage | What | Script | Head required | Then |
|---|---|---|---|---|
| **1a** | 0106, 0107, 0108, 0109 (additive: reason column, charging setting + `guest_sessions`, desk and in-app payment RPCs) | `node scripts/prod-apply.mjs 1a --apply --backup-confirmed` | 0105 | Deploy the `payment-webhook` edge function (purpose `session` dispatch), smoke-test a subscription payment and the webhook round trip, watch `job_runs`. |
| **1b** | **0110 alone** (alert `kind` refactor, no behaviour change; rewrites the alert path of every live gym) | `node scripts/prod-apply.mjs 1b --apply --backup-confirmed` | 0109 | **7-day soak**: front-desk alerts must still raise, dismiss and auto-dismiss on a real gym. Nothing else from V1.6 lands. |
| **2** | 0111 gate, 0112 class gate, 0113 refunds/revenue, 0114 overview RPCs, **0116** alert cooldown | `node scripts/prod-apply.mjs 2 --apply --backup-confirmed` | 0110 | Merge **#52** to master (dashboard deploys against a complete schema). Smoke-test with a throwaway gym with charging ON, then OFF. |
| **3** | 0115 default on for new gyms | `scripts/rollback-0115-*.sql` exists; add stage `3` (head **0116**) to prod-apply.mjs when the gates close | 0116 (0116 was applied with stage 2, so the head is 0116 while 0115 is missing from the ledger) | **Only when** every gate in "Revisit dates and gates" is closed: restore tested, rotation procedure written, `job_runs` alert Action live, 19.11 mobile build live in both stores. |

Mobile: the 19.11 build (pay-for-your-session, offline verification) and the refusal-handling fix must be in the stores **before** stage 3. Old builds show a refused guest the expired screen (no minimum-version gate, by decision).

## Per-stage abort and rollback
- A migration that fails part-way rolls back in its own transaction; fix and re-run. Do not hand-edit production.
- A migration that applied but is wrong is forward-fixed with a new migration. Rollback scripts for the reversible ones: `scripts/rollback-0110-*.sql` ... `rollback-0116-*.sql`.
- Data damage is restored from the pre-stage dump into a scratch database and only the affected rows copied back.

## Done / open
- **1a applied 2026-10-12** via `node scripts/prod-apply.mjs 1a --apply --backup-confirmed` (run by the owner). Still to do for 1a: deploy the `payment-webhook` edge function (needs the Supabase CLI/token) and a dashboard smoke test of a subscription payment.
- **1b applied 2026-10-12 ~17:10 UTC** (`prod-apply.mjs 1b --apply --backup-confirmed`, run by the owner). The 7-day soak ends **2026-10-19**; 0111+ must not land before it. During the soak: confirm front-desk alerts raise, dismiss and auto-dismiss on a real gym (production had 0 alert rows at the time of 0110, so the first real alert is the first live exercise of the rewritten path).

## Open items (original list, kept for the record)
- **Rehearsal never run** (gate 2). Needs the owner's R2 access and age private key.
- **Confirm the hosted PostgREST version** (Dashboard -> Infrastructure). Independent of V1.6, but decides how urgent the mobile refusal fix is.
- The production preflight was run read-only on 2026-10-12: head 0105, 1 gym / 2 members / 0 payments / 0 alerts, no V1.6 objects present, all replaced objects present, `check_in` still the 0105 body, anon cannot execute it. The `db-backup` workflow was triggered and green at 2026-10-12T12:38Z (run 38249526039).
- `scripts/prod-apply.mjs` replaces the container-based shell script (containers here die silently on network lookups). It needs the `pg` module: `npm i pg@8` in a temp dir and `PG_MODULE_DIR=<dir>/node_modules`. Its dry run has **not** been executed yet: the auto-mode permission check denied running it against production, so it needs the owner's explicit go or a permission rule.
