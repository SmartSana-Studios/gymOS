# Deploy Epic 24 (gym landing pages) to production

Migrations **0160-0168** + the three web apps (dashboard, super-admin, landing) + the `page-media-purge` edge function + environment variables + (last, by the owner) the wildcard DNS record.
Production head before: expected **0159** (confirm with `bash scripts/deploy-readiness.sh 0160`, which reads the ledger).
The code is already on `master` (PR #122, 2026-11-10) and Vercel has deployed it; **nothing below is applied yet**. Until the migrations are applied the new screens (dashboard Settings > Landing page and My Website, Super Admin Pages and Page names) cannot load their data. The marketing sites and everyday dashboard flows do not use the new schema, and the landing proxy treats every host as marketing while `PUBLIC_SITE_ROOT_DOMAIN` is unset.
Details of every migration: `docs/decisions.md` entries for Stories 24.4 to 24.12.

## What changes for real gyms

- **0160 revokes `USAGE` on schema `public` from `PUBLIC`.** `anon`, `authenticated`, `service_role`, `postgres` and `supabase_auth_admin` keep their own explicit grants and the full local pgTAP suite passes without the PUBLIC grant, but production has Supabase-internal roles the local suite does not exercise. This is the riskiest line of the epic: see gate G2 and verify it BEFORE applying 0160, not after. It also creates the cluster-level login role `public_site_reader` (no password until gate G2 is closed), schema `public_site`, and the empty `public.gym_pages`.
- **0161** adds page-content columns to `gyms` (`page_*`) and `plans.is_public` plus public labels, with pin triggers (including one on plan insert). Plans stay private by default.
- **0162** creates the Storage buckets `gym-page-media-src` (private) and `gym-page-media` (public) and `gym_page_media` with `register_page_media`.
- **0163** adds page names (claim, hold for review, rename with 12-month redirect), a trigger on `gyms.status`, and the daily cron job `page_names_sweep`.
- **0164 / 0165 / 0166** add the publish gate, the snapshot and the visibility view, `get_gym_page_status`, and `public_site.page_redirects`.
- **0167** adds takedown, reports, appeals, the purge columns and the cron job `page_media_purge` (it calls the edge function; without the Vault secrets below it logs a failure each run and does nothing else).
- **0168** adds `public.list_published_pages()`, a read-only Super Admin function behind Pages > Active (published pages with their `name.gymosapps.com` domain and status). It writes nothing and changes no existing object; rollback is `scripts/rollback-0168-list-published-pages.sql`. The Super Admin app calls it, so apply 0168 before (or with) the Super Admin deploy of the Active tab.
- No gym is published and no name is claimed by the deploy. A page exists only when an Owner publishes it, and it is reachable only after `CNAME *` exists.

## Release gates (close every one before the step it guards)

| Gate | How it is closed | Status on 2026-11-10 |
|---|---|---|
| G1 rollback rehearsal | `bash scripts/rollback-rehearsal-epic24.sh` (local database with 0160-0168 applied). Runs 0168..0160 in one rolled-back transaction and checks what is gone and what stays. | **passes: 8 of 8 on 2026-11-10 (9 of 9 with 0168 added, see the 2026-11-11 run)**, database left untouched. `rollback-0160` did not exist and was written for this; the rehearsal found that `postgres` needs a membership grant before it may drop the reader role, now in the script |
| G2 reader role and `public` schema (hard gate, 24.4 checklist) | Before 0160: run the schema-wide anon/PUBLIC-EXECUTE query and the reader privilege enumeration against production (same queries as `supabase/tests/public_site_reader_privileges.test.sql` and `public_site_anon_isolation.test.sql`), read the `net` and `public` results, and **record in `docs/decisions.md` whether `net._http_response` exposure is revoked or explicitly accepted**. After 0160: confirm Studio, PostgREST, pg_cron jobs, Storage and Realtime still work. **Only then** set the role password (`ALTER ROLE public_site_reader PASSWORD '...'`, out of band, never in git). Then probe connect, `CONNECTION LIMIT 20` and `53300` retry through the production pooler with the real role. | **read-only checks DONE on 2026-11-10** (findings in `docs/decisions.md`, "Epic 24 release gate G2"): the revoke is safe for every role that matters; the `net` exposure is Supabase's default and is **awaiting the owner's explicit accept-or-hold decision**; the internal-roles check after 0160 and the password are still open |
| G3 backup | `scripts/deploy-migration.sh` calls `scripts/lib/require-db-backup.py` itself (reuses a GREEN `db-backup` run from the last 30 minutes, or triggers one) and refuses without it. Restore note: the reader role is cluster-level and is NOT in a per-database dump; after restoring the R2 dump into a fresh cluster, re-run the role block of 0160 and set the password again. | script ready |
| G4 Supabase access token | `scripts/deploy-readiness.sh 0160` must show PASS for the management API. | **PASS on 2026-11-10 14:44Z** after the owner renewed the token (it had answered HTTP 401). Revoke the token in the Supabase dashboard (Account > Access Tokens) when the release is finished |
| G5 env and secrets | Table below. | OPEN |
| G6 staging gate | `scripts/landing-gate/README.md` lists the staging items of the 24.12 release gate (headers over real HTTPS, speed, load, a report from a phone, a takedown and appeal, a purge run). No staging exists; run them against production on a test gym instead, with the owner's agreement. | **SIGNED OFF by the owner on 2026-11-11 without staging**: verified on production with the SmartSana pilot page; `check-http.mjs`, `lcp.mjs` and `load.mjs` were NOT run and the live appeal was not run. See `docs/decisions.md`, "Epic 24 release gate G6" |

## Env and secrets

| Where | Name | Notes |
|---|---|---|
| Supabase function secrets | `PAGE_MEDIA_PURGE_SECRET` | random, 32+ characters; the same value goes into Vault as `page_media_purge_secret` |
| Supabase Vault (SQL) | `page_media_purge_url`, `page_media_purge_secret` | `select vault.create_secret('https://<ref>.supabase.co/functions/v1/page-media-purge', 'page_media_purge_url'); select vault.create_secret('<same random value>', 'page_media_purge_secret');` |
| Vercel `gym-os` (landing) | `PUBLIC_SITE_ROOT_DOMAIN` | `gymosapps.com` |
| Vercel `gym-os` | `PUBLIC_SITE_MEDIA_ORIGIN` | `https://<ref>.supabase.co` (the Storage origin the CSP names) |
| Vercel `gym-os` | `PUBLIC_SITE_REPORT_KEY` | server-only, 16+ random characters, used by the `/report` form (declared in `turbo.json`) |
| Vercel `gym-os` | `PUBLIC_SITE_READER_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD` | five SEPARATE variables (never one URL); user `public_site_reader`, password from gate G2; host and port as decided in `docs/decisions.md` 24.1 and 24.4 (pooler) |
| Vercel `gymos_dashboard`, `gymos-super-admin` | `NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_SUPPORT_EMAIL` | optional: the "need a custom website?" notice. No number means no WhatsApp button; the email defaults to `hello@gymosapps.com`. Same names as the marketing site |

Set them before the first publish, not after. `PUBLIC_SITE_*` are read at request time by the landing app; the two `NEXT_PUBLIC_*` are inlined at build, so a redeploy is needed after setting them.

## Order (migrations first, then the rest)

1. `bash scripts/deploy-readiness.sh 0160` (read-only). Every FAIL must be gone (gate G4 first).
2. Gate G2 read-only checks on production; record the `net._http_response` decision.
3. Trigger a backup by hand if in doubt (gate G3).
4. Apply **one migration at a time, in order**: `bash scripts/deploy-migration.sh 0160`, `0161`, ... `0168`. Each refuses unless the ledger head is exactly the previous version, runs in one transaction with its ledger row, and prints the ledger. After 0160, finish gate G2 (internal roles, then the password).
5. Verify: `bash scripts/deploy-migration.sh 0168 --verify` (the ledger shows 0168 as head). After the edge function is live, run `scripts/landing-gate/purge-staleness.sql` with `psql -v ON_ERROR_STOP=1 -At -f` against production (see `scripts/landing-gate/README.md`).
6. Edge function: `supabase functions deploy page-media-purge --no-verify-jwt`, `supabase secrets set PAGE_MEDIA_PURGE_SECRET=...`, then the two Vault statements above.
7. Env (above), then redeploy the three apps from Vercel (or push) so the build-time variables are in.
8. Merge the pending follow-up branches to master (CI green; Vercel deploys).
9. Smoke test (below).
10. **Last, by the owner:** the wildcard record `CNAME *` (see `docs/runbooks/wildcard-dns-rollback.md`; the A2 AutoSSL result and cert checks are open items in `deferred-work.md`). Until then pages exist but no `*.gymosapps.com` name resolves.

## Smoke test

- Dashboard (as an Owner): Settings shows the Landing page row; My Website opens the editor; saving content works; claim a name (a name with a generic word such as `gym` is HELD for review, `titan-athletics` goes active); upload a logo, a banner and a gallery image; publish.
- Super Admin: Pages > Names shows a held name with its due date; approve and reject each notify the Owner.
- Public page before DNS exists: `curl -sk --resolve <name>.gymosapps.com:443:216.198.79.1 https://<name>.gymosapps.com/` (the apex address from `dig`); expect 200 for the published page, and byte-identical 404s for an unknown, an unpublished, a taken-down and a reserved name. Check the headers against `scripts/landing-gate/check-http.mjs` (`BASE_URL`, `GATE_*`).
- A report from a phone through `/report`; a takedown and an appeal in Super Admin; one `page_media_purge` run in `job_runs`.
- Switch a live page between Classic and Volt in the dashboard; the public page follows.
- Reload any tab left open across the deploy (no Skew Protection on this plan).

## Rollback

Roll the apps back first (the landing app connects as `public_site_reader`; the dashboard status read fails its strict parse against an older database), then `scripts/rollback-0168-*.sql`, `scripts/rollback-0167-*.sql` ... `scripts/rollback-0160-public-site-reader.sql`, newest first, each as `psql -v ON_ERROR_STOP=1 --single-transaction -f <file>`. Rehearse with `bash scripts/rollback-rehearsal-epic24.sh`. Known limits: rolling back 0162 deletes the two buckets only while they hold no objects (run a purge or empty them first); rolling back 0160 drops the role and its password and gives `PUBLIC` its `USAGE` on schema `public` back; every rollback is destructive for the data it covers (published pages, claimed names, uploaded media rows).
