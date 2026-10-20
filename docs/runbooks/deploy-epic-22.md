# Deploy Epic 22 (Super Admin second factor, live authorization) to production

Migrations **0124-0130** + the Super Admin / dashboard apps + the `payment-webhook` edge function (+ a small mobile change).
Production head before: **0123**. The `super_admin_aal2` flag stays **OFF** through this whole deploy.

## What changes for real gyms

- **0124 is the one that touches every gym.** `private.gym_id()` and `private.is_super_admin()` now check live membership, and
  ~130 policies/functions read the live role instead of the token claim. A deactivated or demoted staff member loses access
  immediately instead of at token expiry. Behaviour for active staff is unchanged (pgTAP + the full local suite cover it).
- 0126 / 0129 replace `custom_access_token_hook` (token claims). With the flag OFF it behaves as before; on an error it now
  strips `app_role` / `gym_id` (fail closed) instead of passing the token through.
- Nothing changes in how the Super Admin signs in until the flag is enabled (separate, later, per
  [super-admin-recovery.md](super-admin-recovery.md)). Production has **0 verified factors** today, so enabling needs enrolment first.

## Order (migrations first, then apps)

The new apps call `authorize_action` and the new RPCs, so they must not go out before the database.

1. **Preflight** (read-only): `./scripts/deploy-0124-0130.sh --preflight`. Every line must be PASS. (Run 2026-10-17: all PASS.)
2. **Backup**: take a Supabase dashboard backup / PITR marker now and note the time. 0124 rewrites policies and cannot be undone
   piecemeal except with the rollback scripts below.
3. **Env (Vercel, super-admin project)**: `SUPER_ADMIN_APP_URL` (the public https origin, required in production: without it no
   recovery or invitation mail is sent) and `MAIL_SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` (Resend; the bare address `hello@gymosapps.com` — a `Name <address>` value was refused in production — plus optional `MAIL_FROM_NAME=GymOS` for the display name;
   domain verified). Set before the app deploy, not after.
4. **Migrations**: `./scripts/deploy-0124-0130.sh`. One transaction per migration, ledger row inside it, stops at the first
   failure. It prints the verification block; read it (flag false, 3 guard triggers, hook not callable by `authenticated`/`anon`).
5. **Edge function**: deploy `payment-webhook` (it now calls `authorize_action`).
6. **PR `epic/22` -> master**, CI green, merge. Vercel deploys super-admin and dashboard.
7. **Smoke test** (below).
8. Mobile: the changes are minor (`pay-session`, `renew`, `payments.ts` error mapping). No EAS build is needed to stay correct;
   ship it with the next normal build.

## Smoke test (after the apps are live)

- Super Admin signs in at the Super Admin app, `/gyms` lists the gym, open the gym. No second-factor prompt appears (flag off).
- `/security` loads and shows no enrolled factor.
- Dashboard: owner signs in, members list loads, check-in a member, view payments. A staff member can still do their usual task.
- A deactivated staff account (if any) is refused immediately.
- Supabase auth logs: no `custom_access_token_hook` warnings for 15 minutes.

## Rollback

Rehearsed 2026-10-20 (not run against production). Read this whole section before using any script.

**Order, and why.** The apps and the edge function must go back FIRST. Current master, and `payment-webhook` v7, call functions that the rollback drops (`authorize_action`, the recovery and step-up functions), so rolling the database back under them would break Super Admin sign-in and payment initiation.
1. Redeploy the Super Admin and dashboard apps from before the epic (`a0f0597` plus the gyms-embed hotfix `6072416`) on Vercel.
2. Redeploy `payment-webhook` v6 (the version before the epic).
3. Then the database, in reverse order, one transaction: `scripts/rollback-0132-...` down to `scripts/rollback-0124-...` (`psql -v ON_ERROR_STOP=1 --single-transaction -f <file>`), and delete the ledger rows for the versions rolled back.
4. If a rollback itself fails, stop: restore from the backup in step 2 of the deploy order. (Production had no data backup at deploy time; the only fallback was a definitions snapshot. Turn backups on before relying on this.)

**What a rollback deletes (data, not just code).**
- 0126: the `super_admin_aal2` flag goes, so the second factor stops being required for everyone; sign-in is password-only again.
- 0127: the lockout, session-limit and step-up tables, and with them every lock and grant.
- 0128 / 0131: the registered recovery email, its codes, pending recoveries and the `super_admin_recovery_apply` cron job.
- 0129: the last-verified-factor guard on `auth.mfa_factors`; 0130: the owner / Super Admin separation triggers.
- Authenticators enrolled in Supabase Auth are NOT touched (they live in `auth.mfa_factors`), and no gym, member or payment data is touched.

**Rehearsal result.** `bash scripts/rollback-rehearsal.sh` runs all nine rollbacks in one transaction on a local database with 0124-0132 applied, checks the epic's objects are gone, and always rolls back. Separately, the same transaction was diffed against production as it was BEFORE the epic (the definitions snapshot taken before the 2026-10-17 deploy) and against production now:
- The nine scripts ran without error, in order.
- Functions: 202 before the rollback, 159 after; the 43 removed are exactly the ones the epic created, leaving the same 159 as production before the epic. Policies (135) and triggers (33) are identical to before the epic.
- Tables, columns, indexes, constraints and the cron job: the rollbacks remove exactly the eight private tables with their 38 columns, 13 indexes and 10 constraints, and the one cron job; nothing is left behind and no existing table was altered.
- Of the 33 function definitions the epic changed in production, 32 were restored exactly. Two defects were found and fixed in `rollback-0124` by this rehearsal: it restored `private.gym_id()` with a `raise warning` line production never had (migration 0009 has it, production had drifted), and it did not give back the PUBLIC execute that 0124 revoked from `private.protect_payment_columns_on_staff_verify()` (a trigger function, so no functional effect). After the fix all 33 are identical and every grant the epic changed is restored.
- Not proven: that the pre-epic apps behave correctly against the rolled-back database (not run), and the remaining grant differences between local and hosted Supabase (78 functions the epic never touched; they differ because hosted and local have different default privileges).

## Not part of this deploy

Enabling the flag, enrolling the Super Admin's authenticators, and setting their recovery email. Do those in a separate session
with the runbook in `super-admin-recovery.md`; the enable script refuses unless two verified factors, or one factor plus a verified
recovery email, exist.
