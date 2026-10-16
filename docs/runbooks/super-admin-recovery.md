# Super Admin second factor: bootstrap and recovery

Story 22.6. Run by the platform owner, never by CI. The scripts run as the database owner, default to
dry-run, and write one `audit_log` row per applied run (`actor_display_name` = `operator:<name>`).

Connection (same as `scripts/prod-apply.mjs`): `PROD_HOST`, `PROD_PORT`, `PROD_USER`, `PROD_DB` from env
(defaults point at the deployed pooler), password from `~/.supabase-db-password` (`PROD_PASSWORD_FILE`
overrides), never printed. `pg` is loaded from `PG_MODULE_DIR=<dir>/node_modules` (`npm i pg@8` in a
temp dir). Set `PROD_SSL=0` only for a local database.

## Preconditions

- Migration 0126 is applied (`private.platform_flags` has `super_admin_aal2`).
- A fresh backup (db-backup green) before any `--apply` against production.
- Every Super Admin account has signed in and holds exactly **two verified** TOTP factors on **two
  separate devices** (different friendly names, e.g. `phone`, `tablet`), **or** (Story 22.8) exactly
  **one** verified factor plus a **verified recovery email** (a different mailbox from the login email).

## Bootstrap (turn the flag on, once)

1. Sign in at `/security` with the password, enroll and verify factor one (allowed at aal1; this is the
   recorded first-factor window).
2. Add factor two at `/security` (a second factor needs aal2, so first sign out and back in and pass the
   factor-one code challenge by opening `/auth/mfa` yourself; with the flag off nothing redirects there,
   so type the URL after signing in).
3. Dry run: `node scripts/enable-super-admin-aal2.mjs`. It lists every Super Admin with each factor's
   friendly name and `created_at` and states the verdict. It refuses (exit 1) unless every
   `users.is_super_admin` account has exactly two verified factors.
4. Apply: `node scripts/enable-super-admin-aal2.mjs --apply --operator <your-name>`, type the
   confirmation phrase. Running it again prints "already on" and changes nothing.
5. Check: a fresh password sign-in lands on `/auth/mfa`; the code reaches `/gyms`.

## Lost one device

The other factor still works. Sign in (password + code from the surviving device), open `/security`,
remove the lost factor (needs aal2, refused if it would leave none), enroll a replacement on a new device.
The flag stays on. Nothing for the scripts to do. If the lost device was ever unlocked or shared, treat
it as a secret exposure: rotate the password too.

## Lost both devices (out-of-band reset)

Only the platform owner, on the account owner's request, after verifying identity outside the app.

1. Dry run: `node scripts/reset-super-admin-factors.mjs <email>`. Lists the factors and sessions that
   would go.
2. Apply: `node scripts/reset-super-admin-factors.mjs <email> --apply --operator <your-name>`, type the
   confirmation phrase. One transaction deletes the account's factors and `auth.sessions` and sets the
   flag **off**, with one audit row.
3. Immediately: the Super Admin signs in with the password, enrolls and verifies **both** factors at
   `/security`, then you re-run the Bootstrap steps 3 to 5.

Why the flag goes off: with the flag on and zero factors an aal1 session is denied at the admin layout,
so `/security` is unreachable and the account would be locked out. The reset reopens the first-factor
window on purpose (sessions are deleted, but an access token already issued can work until it expires, at most one hour); keep it as short as possible and do not leave the platform on flag-off overnight.

## Dual control

Today there is a single Super Admin, so the reset is one operator's decision, recorded in `audit_log`.
Once a second Super Admin exists (PRD section 8 / FR-191), a reset must be requested by one and applied
by the other; the operator name in the audit row must differ from the target.

## After any run

Check `select action_type, actor_display_name, created_at from audit_log where actor_display_name like 'operator:%' order by created_at desc limit 5;`
and that `select enabled from private.platform_flags where flag = 'super_admin_aal2'` is what you expect.

## Session limits, step-up and lockout (Story 22.7)

Applies only while the flag is on. Limits are rows in `private.session_limits_config` (`idle_minutes`
30, `absolute_session_minutes` 480, `stepup_ttl_minutes` 5, `stepup_failure_threshold` 5; all
`[ASSUMPTION]`); change them with a plain SQL update (not audited by the database; record the change in `docs/decisions.md`), not a deploy.

- **Session expired.** An idle (30 min) or over-age (8 h) session is removed on its next request and the
  login page says the session expired. Just sign in again.
- **Step-up.** Removing a verified factor and creating or promoting a Super Admin ask for a fresh
  authenticator code, valid 5 minutes, single use, bound to that factor or email.
- **Locked after wrong codes.** Five wrong step-up codes lock the account and remove its sessions
  (audit rows `super_admin_stepup_failed` and `super_admin_locked`, counts only). The sign-in prompt at
  `/auth/mfa` is not counted. A locked account can only be released with the reset script above
  (`reset-super-admin-factors.mjs`), which also clears the lock, session state and step-up grants and
  turns the flag off; re-bootstrap as described.

## Recovery by email (Story 22.8)

For a Super Admin with a verified recovery email who has lost the device holding their authenticator.
No operator needed.

1. **Setup (once, before the flag is on).** `/security` → *Recovery email* → enter a mailbox that is NOT the
   login email → enter the 6-digit code mailed there. Changing or removing it later asks for a step-up.
2. **Recover.** Sign in with the password. On `/auth/mfa` choose *Can't use your authenticator?* → *Email me
   a code* → enter the code. Nothing happens immediately: the reset is **scheduled 30 minutes later**
   (`recovery_delay_minutes`), and both mailboxes receive a notice with a **cancel link**.
3. **After the delay** (checked every minute by pg_cron job `super_admin_recovery_apply`) the account's
   authenticators and sessions are removed. The flag stays **on**. Signing in with the password now leads to
   `/auth/mfa/enroll`, where the first new authenticator can be enrolled. That window lasts 24 h
   (`recovery_enrol_window_minutes`) and closes as soon as a factor is verified. Add the second one, or keep
   the recovery email as the backup.
4. **Not you?** Open the cancel link in either email, or an operator runs
   `node scripts/reset-super-admin-factors.mjs <email> --cancel-recovery --apply --operator <name>`.
   An operator full reset also cancels a scheduled recovery. A locked account is never reset by a recovery.

Limits (all in `private.session_limits_config`): code valid 10 min, 3 wrong attempts then the code is dead,
3 requests per hour and 5 per day, wrong codes also count toward the step-up lockout. Audit actions:
`super_admin_recovery_requested`, `_code_failed`, `_accepted`, `_cancelled`, `_applied`, `super_admin_recovery_email_set`
and `_removed`. Mail needs the production env vars in `apps/super-admin/.env.example` (Resend SMTP) and
`SUPER_ADMIN_APP_URL` (the origin used in cancel links; recovery refuses to start in production without it).

Risk to keep in mind: the password plus the recovery mailbox is enough to take the account over once the
delay passes. Protect that mailbox like the login, and treat a notice you did not expect as an incident.
