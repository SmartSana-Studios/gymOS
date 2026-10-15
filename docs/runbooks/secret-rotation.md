# Secret rotation

Owner: `josephfeussi`. Written 2026-10-15 (it was an open gate from the Epic 19 retro, item 3).
**Rotate immediately on any exposure** (a secret pasted in chat, a leaked log, a lost laptop).
Otherwise rotate on the schedule in the last section.

Project ref: `vfxezibagiznrirdwkwh`. Supabase CLI is pinned: `npx supabase@2.109.0 ...`.
Console steps are named by what to do, not by menu path; menus move. Every rotation ends with the
**Verify** line, which is the only thing that proves it worked.

## 1. Where every secret lives

| Secret | Lives in | Used by |
|---|---|---|
| `SEND_SMS_HOOK_SECRET` | Supabase function secret **and** the Auth hook config | `send-sms-hook`, Supabase Auth |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WHATSAPP_*` | Supabase function secrets; Vercel env (dashboard, super-admin) | OTP, WhatsApp invites |
| `OTP_PROVIDER`, `REVIEW_TEST_PHONE`, `SENT_DM_*` | Supabase function secrets | `send-sms-hook` |
| `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY` | Supabase function secrets; Vercel env | WhatsApp invites and OTP fallback |
| `TARAMONEY_API_KEY`, `TARAMONEY_WEBHOOK_SECRET` | Supabase function secrets (platform account, SaaS billing) | `payment-webhook` |
| `TARAMONEY_BUSINESS_ID` | Supabase function secret **and** Vault (`platform:taramoney:business_id`, the collision guard) | `payment-webhook`, migration 0083 guard |
| Per-gym Tara credentials | Vault, per gym, written by Settings -> Payment account | `payment-webhook` (read by `get_gym_payment_credentials_by_business_id`) |
| `PAYMENT_WEBHOOK_PUBLIC_BASE_URL` | Supabase function secret (not a credential; a pinned URL) | `payment-webhook` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (managed) and Vercel env (dashboard, super-admin) | server code, scripts |
| publishable / anon key | Supabase; Vercel env `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; mobile build env | browsers, mobile |
| Database password | Supabase; `BACKUP_DB_URL`, `JOB_ALERT_DB_URL` (GitHub); `~/.supabase-db-password` (devcontainer) | `db-backup`, `job-runs-alert`, `prod-apply.mjs` |
| Supabase access token (PAT) | `~/.supabase/access-token` (devcontainer) | Management API, `supabase db query --linked` |
| `CRON_SECRET` | Vercel env (dashboard) | `/api/cron/saas-billing-reminders` |
| `SENTRY_AUTH_TOKEN`, PostHog keys | Vercel env; EAS build env | source maps, analytics |
| `EXPO_TOKEN` | `~/.expo-token` (devcontainer) | EAS builds and submits |
| App Store Connect API key | EAS servers | `eas submit` (iOS) |
| Google Play service account | `apps/mobile/google-play-service-account.json` (gitignored, on disk) | `eas submit` (Android) |
| `R2_*`, `BACKUP_AGE_PUBLIC_KEY`, `SUPABASE_S3_*` | GitHub Actions secrets | `db-backup` |
| age **private** key | the owner, outside GitHub and outside this repo | restore only |

## 2. Rules that apply to every rotation

1. **Two places, one value.** Where the table says "and", change both, or the two sides disagree and the feature fails
   closed. Do them in the order given in each section.
2. **Warm isolates cache module-scope secrets** (deferred-work, Story 2.9 review). After changing any function secret,
   redeploy the function that reads it (`npx supabase@2.109.0 functions deploy <name> --project-ref vfxezibagiznrirdwkwh`)
   so running isolates are recycled, then verify.
3. **Vercel env changes need a redeploy** to take effect (push to master or redeploy the project).
4. **Never paste a secret into chat, an issue, a PR or a commit.** If you did, that secret is exposed: rotate it now.
5. **Record it.** Add one line to `docs/decisions.md` (date, which secret, why) and a `# last_updated:` line in
   `sprint-status.yaml`. Never write the value.
6. Do not rotate two payment-path secrets at once. One change, one verification.

## 3. Procedures

### 3.1 Tara Money, per-gym credentials (the SmartSana key, Epic 18 retro item 22)
1. At Tara, issue a new API key and webhook secret for the gym's business account. **Leave the old key valid for now**,
   so the gym can keep taking payments while you switch over.
2. In the dashboard as the gym owner: Settings -> Payment account -> reconnect, with the new values.
3. **Verify:** the card shows connected; make one real session payment (the smallest amount) and confirm it lands as
   `verified` in Payments. A failed webhook shows in the Tara dashboard and in Edge Function logs.
4. Only after the verification passes, revoke the old key at Tara. This is the step that actually closes the exposure.
   If the verification fails, the old key still works: fix or retry before revoking.

### 3.2 Tara Money, platform account (SaaS billing)
1. At Tara, issue a new key and webhook secret.
2. Set the function secrets: `npx supabase@2.109.0 secrets set TARAMONEY_API_KEY=... TARAMONEY_WEBHOOK_SECRET=... --project-ref vfxezibagiznrirdwkwh`.
   The business id is not a credential and does not change with a key; if it ever does, update the function secret and the
   Vault copy `platform:taramoney:business_id` together.
3. Redeploy `payment-webhook`.
4. **Verify:** one test SaaS payment settles. If the business id changed, run the digest check in
   `docs/deploy-runbook.md` section 2 (Vault hash equals the function secret's digest).

### 3.3 `SEND_SMS_HOOK_SECRET`
1. Generate a new `v1,whsec_...` value.
2. Set it on the Auth hook (Supabase dashboard -> Authentication -> Hooks -> Send SMS) and as the function secret in the same
   sitting; a mismatch rejects every OTP.
3. Redeploy `send-sms-hook`.
4. **Verify:** request an OTP for the review phone (`REVIEW_TEST_PHONE`) and confirm login completes.

### 3.4 Twilio / Evolution API / Sent.dm
1. Create the new credential at the provider, keep the old one valid.
2. `supabase secrets set ...` for the function, `vercel env` for the apps (3.8), redeploy both.
3. Revoke the old credential at the provider.
4. **Verify:** one OTP, and one WhatsApp invite from the dashboard.

### 3.5 Supabase keys and the database password
- **Database password:** reset it in the Supabase dashboard, then update, in this order: GitHub `BACKUP_DB_URL` and
  `JOB_ALERT_DB_URL` (`gh secret set`), then `~/.supabase-db-password`. **Verify:** trigger `db-backup` and check the
  next hourly `job-runs-alert` run is green.
- **Service-role / publishable keys:** rotate in the dashboard, then Vercel env for both apps and the mobile build env,
  then redeploy. A new service-role key is the one that breaks everything if missed: do it in a quiet window and keep
  the old key valid until the apps are redeployed. **Verify:** dashboard login, member OTP login, one check-in.
- **JWT secret:** do not rotate casually. It signs every session; rotating it logs everyone out and invalidates issued
  keys.
- **Access token (PAT):** revoke the old token in the account's token list, create a new one, write it to
  `~/.supabase/access-token` with `! printf '%s' '<token>' > ~/.supabase/access-token`. **Verify:** `supabase db query --linked "select 1"`.

### 3.6 Backups: R2 and the age key
- **R2 keys:** create a new API token, `gh secret set R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, trigger `db-backup`,
  then revoke the old token. **Verify:** the run is green and a new `db.<stamp>.dump.age` exists.
- **age key pair:** generate a new pair (`age-keygen`), `gh secret set BACKUP_AGE_PUBLIC_KEY` with the new public key,
  keep the **old private key** until every dump encrypted with it has aged out (30-day retention), store the new
  private key in two places outside GitHub. **Verify:** trigger `db-backup`, then run `scripts/restore-test.sh` with the
  new key against the new dump. Losing the private key makes every dump unreadable.

### 3.7 Mobile: EAS, stores, Sentry
- **`EXPO_TOKEN`:** create a new token in the Expo account, replace `~/.expo-token`, revoke the old one.
  **Verify:** `npx eas-cli whoami`.
- **App Store Connect API key:** managed by EAS; to rotate, remove and re-create it with `eas credentials`.
- **Google Play service account:** create a new key for the service account in Google Cloud, replace the JSON file,
  delete the old key. **Verify:** `eas submit --platform android --latest` against the internal track.

### 3.8 Vercel env
```
npx vercel env rm <NAME> production --scope josephfeussis-projects --cwd apps/<app>
npx vercel env add <NAME> production --scope josephfeussis-projects --cwd apps/<app>
```
Redeploy afterwards. `vercel env ls` shows creation dates only, so it cannot confirm the value is current: verify
behavior, not the listing. Variables marked sensitive cannot be read back.

## 4. Devcontainer credentials (remove when not in use)

These sit on disk in the development container: `~/.supabase/access-token`, `~/.supabase-db-password`, `~/.expo-token`,
`apps/mobile/google-play-service-account.json`, and any `.env.local`. They are standing credentials with production
reach. Delete them when a session no longer needs them and revoke them at the provider; re-create on demand.

## 5. Schedule

| What | When |
|---|---|
| Any secret pasted in chat or a log | immediately |
| Supabase access token, EXPO_TOKEN, Vercel tokens | every 90 days |
| Tara keys (platform and each gym) | every 180 days or on staff change at the gym |
| DB password, service-role key | every 180 days |
| age key pair | yearly, or on suspected exposure |
| Twilio / Evolution / Sent.dm | yearly |

First scheduled review: **2026-11-30** (the date the V1.6 runbook set for this procedure).
