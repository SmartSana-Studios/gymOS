---
title: '19-0 V1.6 release readiness ops checklist'
type: 'chore'
created: '2026-10-11'
status: 'done'
baseline_commit: '8e6aa8ab9d1df9618914324cf9dfbfbc9b97236e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** V1.6 (migrations 0106–0115) changes payment and check-in paths on live gyms, but the architecture spine's "Open, not decided" ops list (release order and rollback, backup/PITR, rehearsal environment, secrets rotation, `job_runs` alerting) has no written answers, and the prod project has PITR off with no daily backups listed.

**Approach:** Add one dated "V1.6 release runbook" entry to the top of `docs/decisions.md` (newest first) answering each item with a decision, owner and, where deferred, a revisit date; fold the facts into `docs/deploy-runbook.md`'s `[NEEDS]` markers; close the spine's open list; record 19.0 done in `sprint-status.yaml`.

## Boundaries & Constraints

**Always:** State facts as observed (prod backup posture was read from the Management API on 2026-10-11: `pitr_enabled: false`, `backups: []`; "last tested restore" is "never tested" unless the owner says otherwise). Every item ends in an explicit decision (accept / upgrade / defer with date), never a bare description. Append a `last_updated` entry to `sprint-status.yaml` and keep it parseable.

**Never:** No application code, migrations or CI changes in this story. Do not enable PITR, change the Supabase plan, rotate secrets or build the alerting mechanism here; those are actions the owner takes or separate stories. Do not edit the existing 19.0 text in `epics.md`.

**Decisions (confirmed by the human 2026-10-11):**
1. **Backup:** daily age-encrypted full dump (all schemas, grants kept, roles) plus Storage file copy to a private Cloudflare R2 bucket (EU jurisdiction, 30-day lifecycle) via `.github/workflows/db-backup.yaml` (merged in PRs #35/#36, first fully green run 2026-10-11). PITR / paid-tier upgrade deferred; revisit **2026-12-31**. Restore not yet tested: record "never tested" until the first restore, then its date.
2. **Rehearsal:** restore the latest R2 dump into a local Supabase and apply each of 0106-0115 there before production; each migration's pgTAP must pass on the restored copy. 19.1's hosted-privilege check covers local-vs-hosted default-privilege drift.
3. **Secrets:** record each secret's location (Supabase function secrets, Vercel, EAS, Vault per-gym Tara, GitHub Actions) in the entry; rotation procedure deferred to **2026-11-30** (before 19.12), rotate immediately on any exposure.
4. **Job-failure alerting:** a scheduled GitHub Action querying `job_runs` for failures and failing the run (email) is a separate small story that gates 19.12; interim, a daily manual `job_runs` failure query, owner `josephfeussi`.
5. **Rollback:** forward-fix for all of 0106-0115; trigger the db-backup workflow and confirm it green immediately before each production migration; a half-failed migration rolls back in its own transaction, data damage is restored from that pre-migration dump.

</frozen-after-approval>

## Code Map

- `docs/decisions.md` -- newest-first log; new entry goes under the intro rule, above the 2026-10-11 Tara entry; re-check any cited line numbers after inserting.
- `docs/deploy-runbook.md` -- §2 secrets (`[NEEDS]` at ~l.157), §3 migrations (~l.160), §6 rollback/backup (`[NEEDS]` at ~l.331, ~l.342), §7 Sentry/`job_runs` note (~l.388): update to point at the new entry.
- `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md` -- l.272 "Open, not decided" list to mark answered.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `19-0-…: backlog`; append a `# last_updated:` comment; verify with `uv run _bmad/scripts/*.py` parser.
- `supabase/migrations/` -- cron jobs (0021, 0024, 0032, 0045, 0046, 0056, 0057, 0059) write `job_runs` (0008); source for the "which jobs need alerting" list. Latest migration is 0105.
- Prod project ref `vfxezibagiznrirdwkwh`, region eu-west-1, Postgres 17.6.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append entry: `job_runs` failure-alert Action story, gates 19.12
- [x] `docs/decisions.md` -- add dated "V1.6 release runbook" entry: deploy order for 0106–0115 vs dashboard/mobile (per epic dependency order; 19.6a alone ≥1 week before 19.6b; 0115 last), per-migration forward-only/rollback and half-failure handling, backup/PITR posture and decision, rehearsal location, secrets table (location + rotation or deferral date), job-failure alert mechanism and owner -- records the five confirmed Decisions
- [x] `docs/deploy-runbook.md` -- replace the three `[NEEDS]` markers it answers with a pointer to the entry
- [x] `ARCHITECTURE-SPINE.md` -- mark the open list items resolved/pointed
- [x] `sprint-status.yaml` -- 19-0 backlog → done with pointer to the entry; `last_updated` line

**Acceptance Criteria:**
- Given the decisions entry, when read, then it covers all six epic ACs: deploy order, per-migration rollback, backup/PITR with plan tier/retention/last restore, rehearsal location, secrets locations and rotation, job-failure path.
- Given any item not yet in place (e.g. alerting), when recorded, then it is marked as a 19.12 gate with an owner rather than described as done.
- Given sprint-status, when parsed, then it loads and 19-0 shows done.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Job list omits `saas_billing_lifecycle` (edge-case) | medium | patch | 0071 inserts job_runs rows under that name; added, and the alert query covers every job_name. |
| Plan tier unreadable, no follow-up action (edge-case) | low | patch | Added owner confirmation at the 2026-12-31 revisit. |
| `last_updated` key unchanged, only comments (edge-case, blind) | low | patch | Key updated to 10-11-2026 13:25; comment lines kept per the repo's parseability convention. |
| Migration numbering vs chain order 0112/0113 (edge-case, blind) | low | patch | 19.7 and 19.8 have different parents; apply in number order, stated in section 1. |
| Pre-migration dump has no freshness/content check (edge-case) | false | n/a | db-backup runs `pg_restore --list` and `head-object` before succeeding; it is triggered immediately before the migration. |
| Rollback says "no V1.6 data" but 0110 touches live alert rows (edge-case, blind) | medium | patch | Section 2 now states 0106-0110 have no kill switch and 0110's fix must handle existing rows. |
| "7 days clean" undefined (blind) | medium | patch | Defined in section 2 (failed/stale job_runs, Sentry check-in errors, owner sign-off). |
| job_runs failed-rows query misses jobs that never ran (blind) | medium | patch | Staleness check added to section 6 and the deferred-work item. |
| Rehearsal restores PII/secrets with no safeguards (blind) | medium | patch | Safeguards paragraph added to section 4. |
| RPO/RTO, single key holder, payment reconciliation after incident (blind) | low | patch | Reconciliation bullet added; key custody second-place already a first-restore action; RTO measurement arrives with the first restore. |
| Rotation contradiction with open retro item 22; read-only credential; BACKUP_DB_URL risk (blind) | medium | patch | Sentence and gate row added; secrets table rows added. |
| 0115 gating incomplete (blind) | medium | patch | 0115 row, gates table and spine now list every gate. |
| Story marked done with gating items open (blind) | low | patch (partial) | 19.0 ACs are decide-and-document; the open items are listed as gates in the entry. No status change. |
| deploy-runbook stale heading, awkward paragraph, backup-failure alert (blind) | low | patch | Heading and closing paragraph fixed; backup-failure notification note added to section 3. |
| No verification gaps (verification-gap) | n/a | n/a | Layer reported none. |

## Verification

**Commands:**
- `uv run _bmad/scripts/*.py` (sprint-status parser) -- expected: parses with no errors
- `grep -n "V1.6 release runbook" docs/decisions.md` -- expected: one entry

**Manual checks (if no CLI):**
- No remaining `[NEEDS]` for backup tier or secrets in `docs/deploy-runbook.md` unless explicitly deferred with a date.
