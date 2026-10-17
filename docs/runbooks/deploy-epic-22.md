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
   recovery or invitation mail is sent) and `MAIL_SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` (Resend, sender `hello@gymosapps.com`,
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

Reverse order, one transaction each, only if the smoke test fails and the cause is the database:
`scripts/rollback-0130-...`, `0129`, `0128`, `0127`, `0126`, `0125`, `0124` (all in `scripts/`). Then delete the ledger rows
for the versions rolled back. `0124` and `0126`/`0129` restore the previous function bodies; if the rollback itself fails, restore from
the backup in step 2. The apps are backwards-safe to redeploy from master (`a0f0597` + hotfix).

## Not part of this deploy

Enabling the flag, enrolling the Super Admin's authenticators, and setting their recovery email. Do those in a separate session
with the runbook in `super-admin-recovery.md`; the enable script refuses unless two verified factors, or one factor plus a verified
recovery email, exist.
