# Deploy Epic 23 (GymOS support) to production

Migrations **0134-0149** + the Super Admin / dashboard apps + the `payment-webhook` edge function (23-9 touched it).
Production head before: expected **0133** (`docs/decisions.md` records every Epic 23 migration as not yet applied; confirm with `scripts/deploy-readiness.sh 0134`, which reads the ledger).
This runbook is the release gate for the retro items G1-G8 in `_bmad-output/implementation-artifacts/epic-23-retro-2026-10-22.md`.
Production has real gyms: **support is enabled for no gym** by this deploy (every gym's "Allow GymOS Support" switch is OFF), so the
deploy itself gives no support person any access. Enabling a gym is a separate, later, Owner action.

## What changes for real gyms

- **0141 creates one hidden "GymOS Support" proxy user per gym** (a banned `auth.users` row plus a `public.users` row) and backfills it for
  every existing gym. 0149 makes those rows readable by GoTrue: without it the Admin API user listing answers 500 (found 2026-10-22,
  proof below). Apply 0149 in the same window as 0141, never 0141 alone.
- **0140 redefines existing functions** (e.g. `set_registration_fee`, `renew_subscription`, `record_session_payment`) to resolve the
  acting person through the proxy. Behaviour for Owners and staff is unchanged (pgTAP and the full local suite cover it).
- **0143 changes payment-connection semantics for Owners**: replacing a gym payment account no longer overwrites the row; it retires the old row (`retired_at`) and inserts a new one,
  and every payment records the `credentials_id` it was initiated under (backfilled). A daily cron deletes a retired row's Vault secret after 7 days. `payment-webhook` changed with it.
- 0135 and 0146 replace `custom_access_token_hook`. A person with no support assignment gets the same token as before.
- pg_cron jobs added: `support_inactivity_sweep` 03:10 UTC, `support_contact_drift_check` 03:20, `support_factor_reset_due` every 5 minutes (0145), `support_activity_digest` 06:10 (0144), `payment_connection_cleanup` daily (0143). Vercel crons in the Super Admin app
  (`/api/email-outbox/drain` 05:30, `/api/support-factor-reset/execute` 05:40).

## Release gates (close every one before enabling support for any gym)

| Gate | How it is closed | Status on 2026-10-22 |
|---|---|---|
| G1 rollback rehearsal | `bash scripts/rollback-rehearsal-epic23.sh` (needs the local ledger at 0149). Runs 0149..0134 in one rolled-back transaction. | passes: 16 of 16 |
| G2 invite abuse | The four public invite actions (`apps/dashboard/app/support-invite`) have only per-invite attempt counters, no IP or edge limit. | **open**: see "Open at release" |
| G3 env and secrets | Table below. | documented here and in both `.env.example` files |
| G4 GoTrue and proxy rows | Migration 0149. After applying 0141 and 0149, `GET /auth/v1/admin/users?page=1&per_page=1000` with the service key must answer 200. | fixed and proven locally (500 -> 200) |
| G5 0145 backfill | The two `update` statements in 0145 section 2 set `recorded_email` and `recertify_due_at` for existing accounts. Proven locally in a rolled-back transaction: before, `support_live_for` is false (fails closed); after, the e-mail is recorded in lower case, the due date is 90 days out and the account is live. | proven; production has no support accounts yet, so the backfill touches no row there |
| G6 picker window | Owner decision pending (a person who passes the code and leaves before `support_begin_session()` keeps the last-used gym in the next token). | **open** |
| G7 identity reader | Owner decision pending (Super Admin identity reader covers audit rows only). | **open** |
| G8 rollback of 0144 | The script now refuses while any support account is locked (unlock first). Rehearsal clears locks inside its rolled-back transaction. | fixed |

## Env (Vercel)

| Project | Variable | Notes |
|---|---|---|
| super-admin | `SUPER_ADMIN_APP_URL` | public https origin; required in production, without it no recovery or invitation mail is sent |
| super-admin | `DASHBOARD_APP_URL` | `https://owner.gymosapps.com`; builds the invite and reset-cancel links (`/support-invite`, `/support-reset-cancel`) |
| super-admin | `MAIL_SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` | Resend; bare address `hello@gymosapps.com` (see deploy-epic-22.md) |
| super-admin | `CRON_SECRET` | guards `/api/email-outbox/drain` (`Authorization: Bearer`). Without it nothing authenticates the drain and only the Vercel cron calls it |
| dashboard | `SUPER_ADMIN_APP_URL` | the dashboard calls the Super Admin drain right after a payment-connection change (23-9) |
| dashboard | `EMAIL_DRAIN_SECRET` | must equal the Super Admin `CRON_SECRET`. Both are optional: if unset or wrong, the call fails silently and the daily 05:30 cron sends the mail instead (up to about a day late) |

Set them before the app deploy, not after.

## Order (migrations first, then apps)

1. `bash scripts/deploy-readiness.sh 0134` (read-only). Every line must be PASS.
2. Backup: `scripts/deploy-migration.sh` calls `scripts/lib/require-db-backup.py` itself (reuses a GREEN `db-backup` run from the last 30 minutes, or triggers one) and refuses without it. Trigger one by hand first if in doubt.
3. Apply **one migration at a time, in order**: `scripts/deploy-migration.sh 0134`, `0135`, ... `0149`. Each refuses unless the ledger head is exactly the previous version, runs in one transaction with its ledger row, and prints the ledger. Read it after each.
4. Verify: `scripts/deploy-migration.sh 0149 --verify`, then the Admin API check from gate G4.
5. Edge function: deploy `payment-webhook`.
6. Env (above), then PR `epic/23` -> master, CI green, merge. Vercel deploys both apps.
7. Smoke test (below).

## Smoke test

- Super Admin: `/gyms` loads, open a gym; create a throwaway gym and confirm it gets a proxy row and the Admin API listing still answers 200.
- Super Admin: GymOS support page opens with the three buttons and five tabs; no support accounts exist yet.
- Dashboard: an Owner opens Settings; the "Allow GymOS Support" switch shows OFF and no support section is visible to other roles.
- An Owner records a payment and a refund as usual (0140 redefined those functions).
- Reload any tab left open across the deploy (no Skew Protection on this plan).
- Only after all of that: the owner decides whether and for which gym to switch support on, and runs README sections O and S of `scripts/epic23-qa/README.md` on staging data first.

## Rollback

`scripts/rollback-NNNN-*.sql` for each migration, newest first (0149 ... 0134), after rolling the apps back. Rehearse with
`bash scripts/rollback-rehearsal-epic23.sh`. Two known limits: `alter type ... add value` cannot be undone, so 0134 leaves `'support'`
in `member_role`; and the 0144 rollback refuses until every locked support account is unlocked.

## Open at release

- **G2: rate limit on the public invite actions.** Not built. A support invite needs the secret token, which limits abuse to anyone
  holding or guessing a token (per-invite attempt counters apply), but there is no limit per IP. Decide whether to build an edge limit
  before the first support invite is sent in production.
- **G6, G7:** owner decisions, see the table.
