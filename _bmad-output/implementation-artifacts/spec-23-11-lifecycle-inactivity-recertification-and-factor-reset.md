---
title: '23-11 Lifecycle: inactivity, recertification and factor reset'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '2790d3537d56d2ac5052f8aede4ac6b10b695dc9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Idle support accounts keep access forever, nobody re-approves a support person, and a lost authenticator has no safe way back in: reset today means nothing, and a zero-factor account is exposed at AAL1 (first-factor window).

**Approach:** Migration 0145: a `support_inactivity_sweep` cron, quarterly recertification enforced by the live gate, and a Super Admin factor reset (identity check, sessions ended, 30-minute cooling-off, person can cancel, executor job removes the factor and issues a new single-use invite). Phone and email changes go through Super Admin at AAL2 only and are audited. All four items kept in 23.0.

## Boundaries & Constraints

**Always:** Migration 0145 with a rollback script. Values in `private.session_limits_config` (30-day inactivity, 30-minute cooling-off, 90-day recertification, all `[ASSUMPTION]`). Reset keeps `reset_pending_at` set until the new factor is verified (closes the first-factor window). Every path that disables an account or sets `reset_pending_at` ends access through `private.support_revoke_access` (retro 66); new `support_accounts` writers are added by name to both scan arrays. Suspended gyms are excluded from inactivity. Crons and the executor write `job_runs` and are added to `scripts/job-runs-alert.*`. Notices via `staff_notices` + `email_outbox`; EN/FR; names no individual to an Owner. Reset, cancel, recertify, due date and contact changes audited with `private.support_admin_audit`. Identity-check note is mandatory (`support_reason_ok`).

**Decisions (planner, no intent gap):** The executor is a Super Admin route like `email-outbox/drain` calling the Admin API factor delete (verified 200 in decisions.md; SQL delete of `auth.mfa_factors` from a definer is unverified on hosted), driven by a cron-marked due state. The cancel link is a single-use hashed token, as in 0128 `recovery_cancel`. Re-invite after reset reuses the invite tables via a reset-aware issuer (23-5 deferral: re-invite). Recertification due date starts at activation and moves on each recertification; a lapsed account is denied by `support_live` until recertified. Unlock/restore of switch-suspended assignments after recertify or unlock is fixed here (23-10 deferral). Invite refusal and `already_active` in `activate_support_account` get a reset-aware branch.

**Decisions (owner, 2026-10-21):** (1) The person is notified by email only (the email on file); support accounts keep no phone, matching 23.4, and no phone channel is added. (2) The phone/email freeze is enforced by the Super-Admin-only change function, a refusal during cooling-off, and a nightly drift check that locks an account whose auth email differs from the recorded one; no hosted auth setting is changed, so the freeze detects within a day rather than prevents. (3) Keep 23-11 as one story, over the 1,600-token guideline accepted.

**Never:** No self-service reset. No access before the new factor is verified. No trigger on `auth.mfa_factors`. Do not enable support for any gym or apply to production.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Idle account | No activity 30 days, gym active | Disabled via revoke routine, Super Admin notice, audit | `job_runs` row either way |
| Idle, gym suspended | Same, gym suspended | Not counted, not disabled | N/A |
| Recert due | Due date passed | `support_live` denies; Super Admin recertifies (AAL2, reason), new due date, audited | `reason_invalid` |
| Reset start | Super Admin AAL2 + identity note | Sessions ended, `reset_pending_at` set, 30-min timer, contact changes frozen, person notified with cancel link | `step_up_required`, `reason_invalid` |
| Cancel | Person uses link in window | Reset abandoned, sessions stay revoked, Super Admin alerted | expired/used token refused |
| Cooling-off ends | Executor runs | Old factor removed, single-use invite issued, account stays reset-pending until re-enrolled | Failure retried, `job_runs` failure |
| Contact change | Phone/email change | Only Super Admin at AAL2; audited; refused during cooling-off | typed error |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql:47-54,88` -- `support_accounts` columns, `support_live` (add recert-lapsed denial; already denies `reset_pending_at`).
- `supabase/migrations/0144_support_revocation_velocity_lock.sql:41-146,247-290,446,527-595,756` -- `queue_staff_notice`, `notify_super_admins`, `support_revoke_access`, `support_lock_account` (template), `unlock_support_account`, digest cron pattern, restore skip in `set_allow_gymos_support`.
- `supabase/migrations/0143_support_payment_connection.sql:608-674` -- `payment_connection_cleanup` + `cron.schedule` + `job_runs` shape to copy.
- `supabase/migrations/0128_super_admin_recovery_email.sql:377-410,574` -- cooling-off, cancel token, apply job analog; `apps/super-admin/lib/recovery-notify.ts`, `recovery-mail.ts`.
- `supabase/migrations/0138_*.sql:384,422`, `0139_*.sql:118,157` -- `activate_support_account`, `issue_support_invite`, `support_invite_check`: add reset-aware branches.
- `supabase/migrations/0127_session_limits_step_up.sql:88,154` -- `end_user_sessions`, `session_limits_config`.
- `supabase/migrations/0015_*.sql:34-48` -- `protect_self_managed_user_columns` (email not pinned).
- `apps/super-admin/app/(admin)/support/actions.ts:114,315,456,476`, `components/SupportLocksPanel.tsx`, `SupportPageClient.tsx`, `lib/support-invite.ts`, `app/api/email-outbox/drain`, `locales/{en,fr}.json` -- reset/recertify UI, executor route.
- `apps/dashboard/app/support-invite`, `services/supportInvite.ts` -- re-enroll after reset; cancel page.
- `supabase/tests/support_assignments.test.sql:333`, `support_account_invite.test.sql:277`, `support_revocation_velocity_lock.test.sql:509` -- writer scans; `scripts/job-runs-alert.sql:18`, `job-runs-alert.test.sh:16`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0145_support_lifecycle.sql` + `scripts/rollback-0145-support-lifecycle.sql` -- columns, config keys, sweep, recert, reset start/cancel/due, contact-change RPC, invite branches, restore fix
- [x] `supabase/tests/support_lifecycle.test.sql` -- one named test per matrix row and per 23.11 criterion, consumer scan, gate shown failing; update the three scans
- [x] Super Admin actions, panel, executor route, mail, cancel page, EN/FR, types, job-runs-alert
- [x] `docs/decisions.md`, sprint-status

**Acceptance Criteria:**
- Given each matrix row and each 23.11 criterion in `epics.md`, a named test covers it.
- Given `bash scripts/ci-local.sh`, then every stage is PASS.

## Implementation Notes

- Migration `0145_support_lifecycle.sql`, rollback `scripts/rollback-0145-support-lifecycle.sql`, pgTAP `support_lifecycle.test.sql` (164). Decisions in `docs/decisions.md` (Story 23.11). Executor is a Super Admin route (daily Vercel cron 05:40 UTC plus a manual button), so cooling-off is a minimum. Needs `CRON_SECRET` and `DASHBOARD_APP_URL` on the gymos-super-admin Vercel project before shipping. Reset claims only after the cancel e-mail is sent. Not applied to production; back up first.


## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route / evidence |
|---|---|---|
| Restored/reactivated account locked by the next inactivity sweep (activity clock not touched on restore or switch-on) | medium | patch: touch last-active in `support_restore_assignments`; pgTAP case |
| Phone-drift lock has no sanctioned way back (`change_support_contact` rejects phones, unlock refuses while drift persists) | medium | patch: app action clears a stray auth phone; pgTAP/vitest |
| Factor removal can run before the cancel e-mail was delivered (outbox row not linked to the reset, executor never checks) | medium | patch: store `outbox_id` on the reset, claim only when that outbox row is `sent` |
| Reset-start e-mail promises an exact removal time; executor is daily or manual | medium | patch: reword EN/FR "no earlier than" |
| Post-reset invite mail is one language chosen by the Super Admin request or "en" on cron | low-medium | patch: bilingual invite body |
| `changeSupportContact` ignores the revert RPC result | low | patch: check and surface `contact_revert_failed` |
| Stale-claim (10 min) re-claim untested | medium | patch: two pgTAP assertions |
| New step-up action `start_support_factor_reset` untested on both sides | medium | patch: vitest case and pgTAP |
| Recert-due Super Admin notice untested | medium | patch: pgTAP |
| Re-invite button after an executed reset untested | low-medium | patch: component test |
| Super Admin cannot cancel a reset they started | low | reject: reset is recoverable by re-invite; a new cancel action is added public surface the spec did not ask for |
| Cancel token in `email_outbox` body; link origin unvalidated | low | reject: RPC needs Super Admin AAL2; same pattern as invite links |
| `support_factor_reset_mark_due` writes a job_runs row every 5 min | low | reject: job-runs-alert needs a row per window |
| Recert lapse: no Owner notice, sessions not ended, stepup_issue still issues | low | reject: `support_live` denies every request; spec asks only for Super Admin recertify |
| Retry has no cap; stale re-claim can double-send | low | reject: failure shows in job_runs alert; rare |
| Drift check skips a null recorded e-mail | low | reject: support accounts are created with an e-mail, backfill covers existing |
| Refused reset burns step-up; no confirm on Start reset | low | reject: same as other step-up actions |
| start_support_factor_reset does not consume step-up in SQL | low | reject: Super Admin actions enforce step-up in the app (22.8 pattern) |
| Factor enrolled by someone else satisfies activation | low | reject: activation needs the single-use invite token |
| Cancel on a deactivated account clears reset_pending_at | low | reject: deactivated accounts have no live assignments |
| No Owner notice on cancel/complete; rollback guard; untested list mapping, cancel page, runDueFactorResets locale | low | reject: cosmetic or test-only, no named harm |
| Contact freeze detects not prevents; 30-min is a minimum | n/a | reject: owner decision 2026-10-21 and recorded in decisions.md |
| Spec record sections empty; epic-23-context addition describes 23-10 | false | Implementation Notes/Triage are filled by this step; context line is a compile artifact |

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN, every stage PASS

### Review Findings

Code review 2026-10-21 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). 1 decision-needed pair, 1 patch, 3 deferred.

- [x] [Review][Patch] Reset executor mails the invite to the live auth e-mail and ignores lock/drift [supabase/migrations/0145_support_lifecycle.sql:1003-1034] — `claim_support_factor_resets` returns `lower(au.email)` from auth.users and never checks `locked_at` or `support_contact_drifted()`. A password holder who changes the auth e-mail after the 03:20 drift check (or on a locked account) gets the factor removed and a live invite at 05:40. Fix: claim skips accounts that are locked or drifted, and returns `recorded_email`; add a pgTAP case for a drifted claim. (acceptance-auditor) APPLIED: claim skips locked/drifted accounts and returns recorded_email; 3 pgTAP cases.
- [x] [Review][Decision] Cancel link dies when the 5-minute cron marks the reset due, though the factor is removed only at the daily executor (up to ~24 h later) [supabase/migrations/0145_support_lifecycle.sql:937-955] — `cancel_support_factor_reset` needs `state = 'cooling_off' and executes_at > now()`. Option A: keep the window as specified (30 min, e-mail already says "no earlier than"). Option B: accept cancel in `due` too (until the executor claims it). (blind-hunter + edge-case-hunter) RESOLVED 2026-10-21: option A, keep the 30-minute window as specified (rejected). RESOLVED 2026-10-21: keep the 30-minute window as specified (rejected).
- [x] [Review][Decision] A reset whose cancel e-mail is never sent stays `due` forever with no alert [supabase/migrations/0145_support_lifecycle.sql:1022] — claim requires `email_outbox.status = 'sent'`; a failed row or a nulled `outbox_id` leaves the account `reset_pending` and locked out, with no job_runs failure, notice or timeout. Options: alert Super Admins after N hours; mark the reset failed/cancelled after N hours; accept (panel shows `reset_state`). (blind-hunter + edge-case-hunter) RESOLVED 2026-10-21: auto-cancel 24 h after the cooling-off ends and alert Super Admins. APPLIED in claim_support_factor_resets (state cancelled, last_error notice_undelivered, audit support_factor_reset_abandoned); 4 pgTAP cases. RESOLVED 2026-10-21: auto-cancel 24 h after the cooling-off ends and alert Super Admins. APPLIED in claim_support_factor_resets (state cancelled, last_error notice_undelivered, audit support_factor_reset_abandoned); 4 pgTAP cases.
- [x] [Review][Defer] Pre-existing-row backfill of `recorded_email` / `recertify_due_at` has no test [supabase/migrations/0145_support_lifecycle.sql:72] — deferred: one-time event; run the two statements in a rolled-back transaction on a pre-0145-shaped row before the prod migration. (verification-gap)
- [x] [Review][Defer] `change_support_contact` hardcodes `@gymosapps\.com` in SQL [supabase/migrations/0145_support_lifecycle.sql:1344] — deferred (unverified medium): settle by checking whether invite creation enforces the same domain; if not, the two paths disagree. (blind-hunter + acceptance-auditor)
- [x] [Review][Defer] Stray 23-10 bullet (`support_audit_action_not_allowed`) added to epic-23-context.md [epic-23-context.md:37] — deferred: edits an agent-context file; unrelated to 23-11, move or drop at merge.

#### Rejected

- Step-up consumed before RPC refusal (low): redo of a code, fix adds validation duplication.
- Null `recorded_email` never drifts (low): insert trigger and backfill fill it; accounts need an auth user.
- Unbounded retries / re-mail (low): `record_support_factor_reset_run` failures reach job-runs-alert; re-mail only after a done-write failure.
- Executor used-link branch after a failed done-write (low): state label only; access works.
- Recertification notice missed if the sweep skips a night (low): access is denied regardless, panel shows it, job failure alerts; fix needs a new column.
- Contact-change non-atomic window and dead `p_phone` argument (low): daily job vs. millisecond gap; unlock path recovers.
- Lapsed `recertify_due_at` after reset still denies (false): intended, recertification is its own step.
- Unlock does not warn of lapsed recertification; Owner "resumed" notice (low): cosmetic, already in deferred-work.
- Rollback script can strand pending resets (low): header already says to finish them first; guard adds branching.
- 5-minute due cron writes 288 job_runs rows/day (low): negligible volume.
- Audit via `support_audit` instead of `support_admin_audit` for cancel/execute (false): those have no admin actor.
- ~24 h executor latency; e-mail-only notification; step-up in app not SQL; sessions not ended at recert lapse (false): accepted owner decisions / 22.8 pattern / gate denies each request.
- Phone mass-lock on existing rows (false): production has no support accounts before 0133 (23-8 historic-row check).
- Spec frontmatter `status: done`, empty change log (rejected): fix edits the spec under review.
