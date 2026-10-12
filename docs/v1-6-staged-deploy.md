# V1.6 (Epic 19) staged production deploy

Status: **prepared 2026-10-12, nothing applied.** Source of the rules: `docs/decisions.md`, "V1.6 release runbook" (2026-10-11), section 1 (order), 2 (rollback), 3 (backup), 4 (rehearsal). PR: `epic/19` -> `master` (#52).

Production has live gyms. Everything V1.6 is off per gym until an Owner/Supervisor enables it, so the risk is in the *plumbing* migrations (0106-0110 touch live payment/alert paths) and in ordering the dashboard deploy after the schema it queries.

## Why the PR cannot simply merge first
Merging to `master` auto-deploys the dashboard (Vercel Git integration). The epic's dashboard code queries objects that do not exist in production until the migrations are applied (`front_desk_alerts.kind`, `session_attempts`, `guest_sessions`, the Guest sessions RPCs). **Merge #52 only after stage 2 below is applied.**

## Gates, every stage (runbook rules a-d)
1. Trigger `db-backup` (`workflow_dispatch`) and confirm the run **green immediately before** the stage.
2. **Rehearsed** against a restored dump: restore the latest R2 dump into a local Supabase (age key is the owner's), then run the stage script with `PROD_HOST=localhost PROD_PORT=5432 PROD_USER=postgres PROD_PASSWORD_FILE=<file>`. Record the date as the "last tested restore" line in section 3 (currently *never tested*).
3. Preflight (`scripts/preflight-v16-stage1.sql`, read-only): no STOP lines.
4. CI green on the merge commit: `scripts/ci-local.sh` was green for the epic head (see the PR).
5. Apply with the per-stage deploy script (host psql, one transaction per migration, ledger row in the same transaction). Never `supabase db push`.

## Stages
| Stage | What | Script | Head required | Then |
|---|---|---|---|---|
| **1a** | 0106, 0107, 0108, 0109 (additive: reason column, charging setting + `guest_sessions`, desk and in-app payment RPCs) | `scripts/deploy-0106-0110.sh 1a --backup-confirmed` | 0105 | Deploy the `payment-webhook` edge function (purpose `session` dispatch), smoke-test a subscription payment and the webhook round trip, watch `job_runs`. |
| **1b** | **0110 alone** (alert `kind` refactor, no behaviour change; rewrites the alert path of every live gym) | `scripts/deploy-0106-0110.sh 1b --backup-confirmed` | 0109 | **7-day soak**: front-desk alerts must still raise, dismiss and auto-dismiss on a real gym. Nothing else from V1.6 lands. |
| **2** | 0111 gate, 0112 class gate, 0113 refunds/revenue, 0114 overview RPCs, **0116** alert cooldown | *to write after 1b is clean* (same shape; one script per stage) | 0110 | Merge **#52** to master (dashboard deploys against a complete schema). Smoke-test with a throwaway gym with charging ON, then OFF. |
| **3** | 0115 default on for new gyms | `scripts/rollback-0115-*.sql` exists; deploy script to write | 0114 (+0116) | **Only when** every gate in "Revisit dates and gates" is closed: restore tested, rotation procedure written, `job_runs` alert Action live, 19.11 mobile build live in both stores. |

Mobile: the 19.11 build (pay-for-your-session, offline verification) and the refusal-handling fix must be in the stores **before** stage 3. Old builds show a refused guest the expired screen (no minimum-version gate, by decision).

## Per-stage abort and rollback
- A migration that fails part-way rolls back in its own transaction; fix and re-run. Do not hand-edit production.
- A migration that applied but is wrong is forward-fixed with a new migration. Rollback scripts for the reversible ones: `scripts/rollback-0110-*.sql` ... `rollback-0116-*.sql`.
- Data damage is restored from the pre-stage dump into a scratch database and only the affected rows copied back.

## Open items before 1a
- **Rehearsal never run** (gate 2). Needs the owner's R2 access and age private key.
- **Confirm the hosted PostgREST version** (Dashboard -> Infrastructure). Independent of V1.6, but decides how urgent the mobile refusal fix is.
- 1a/1b scripts and the preflight were syntax-checked and the preflight ran read-only against the local DB; they have **not** been run against a production-shaped database yet. The rehearsal is where that happens.
