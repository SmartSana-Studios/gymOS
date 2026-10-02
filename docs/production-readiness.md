# Production readiness

_Last updated: 2026-10-02._

A running, honest picture of what is deployed, what is proven, and what is not. Written so the next person does not have to reconstruct it — and specifically so the gap that opened this session (production five migrations behind, nobody aware) cannot open silently again.

## Current state

| | State | Verified how |
|---|---|---|
| **Database** | `0094` — at parity with the repo | Post-deploy checks on production: 21 guarded write-RPCs, 21 tables carrying `tenant_active_gate`, 0 policies granting manager without supervisor, separation trigger present |
| **Dashboard** | Deployed, on its final domain | `https://app.gymosapps.com` (custom domain attached 2026-10-02; the Vercel-generated `dashboard-tau-three-31.vercel.app` still resolves). Serves `id="identifier"` and "Send code" — the login and reset fixes are live |
| **Super Admin** | Deployed, on its final domain | `https://portal.gymosapps.com` (custom domain attached 2026-10-02; `super-admin-phi-jade.vercel.app` still resolves), Ready in Production |
| **Landing page** | In progress | `https://gymosapps.com` — `apps/landing`, added 2026-10-02 |
| **Mobile** | Published on both stores | App Store "GymOS Member App" (`id6798403711`, released 2026-09-16) and Play "GymOS" (`com.smartsana.gymos`) both resolve publicly — confirmed 2026-10-02. Behaviour still not assessed |
| **Deploys** | Automatic on push to `master` via Vercel Git integration | Four production builds observed following pushes |

Production data as of the deploy: **1 gym, 2 members, 3 auth users, 1 subscription, 0 payments.** Effectively empty — no customers to disrupt.

## What is proven, and what only looks proven

**Proven on production:** the schema. Every post-condition above was queried against the live database, not inferred from a passing local suite.

**Proven locally only:** behaviour. The pgTAP suite (94 files, 1964 assertions) and dashboard tests (308) all pass, and the schema now matches — but no suspended-gym denial has been exercised end to end *on production*. The local database and the production database have different data and different configuration.

**Specifically untested in production — the one to check first:** staff password reset by OTP. It works locally *because of the `test_otp` bypass in `supabase/config.toml`* (`+237670000001` → `123456`). Production has no such bypass; that path depends on the real Evolution API / Twilio chain being configured there, which has not been exercised. "It worked locally" does not carry over for this flow.

## Before onboarding a first client

1. **Role-by-role smoke test on production.** Create a gym → add staff of each role → sign in as each → add members → take a payment → onboard a member on mobile → check in → renew. Two total blockers were found this session by doing exactly this locally for twenty minutes; neither was caught by a green test suite.
2. ~~**A real domain.**~~ — **done (2026-10-02)**: `gymosapps.com` is attached to Vercel — `app.gymosapps.com` (dashboard), `portal.gymosapps.com` (super-admin), apex reserved for the landing page. Two follow-ups this creates: the privacy-policy URL registered in **both store consoles** still points at the old Vercel host and must be re-pointed to `https://app.gymosapps.com/privacy` (a dead policy URL is a store-review failure), and `DASHBOARD_APP_URL` must be set to `https://app.gymosapps.com` on **both** Vercel projects — it is what a new owner and new staff receive as their login link over WhatsApp.
3. **Triage the 384 open items** in `deferred-work.md` into before/after first client. Nobody has done that pass. Most are minor; a few are not.
4. **12 Dependabot vulnerabilities (11 high)** on the default branch.

## Traps worth knowing

- **`supabase db push` is not safe here.** The CLI's container commands can fail silently and still exit 0 (`project_docker_no_network`). Deploy with `scripts/deploy-0090-0094.sh`'s pattern — host `psql`, one transaction per migration, version row written in the same transaction — and verify the head afterwards rather than trusting an exit code.
- **`.vercel/project.json` is stale.** It points at a project that returns "deleted, transferred, or you don't have access". The live projects are `gymos_dashboard` and `gymos-super-admin` under `josephfeussis-projects`. Any `vercel` CLI command run from the repo root targets the wrong thing.
- **`gymosdashboard.vercel.app` is not this app.** It serves a different site (title "GymOS - Ultimate Gym Management", with a `/login` route this repo does not have — ours is `/auth/login`, title "GymOS"). Do not share it as the product.
- **`docs/decisions.md` is newest-first**, so every new entry shifts every line number. Cite an entry's dated heading, never a line. This broke citations three stories running before the live ones were converted.

## Why the drift happened, and what now prevents it

Production sat five migrations behind while CI was green, because CI tests the repo and nothing checks the deployed database against it. Two guards were added this session, both failing loudly rather than silently:

- `scripts/preflight-prod-deploy.sql` — read-only, reports PASS/WARN/STOP, and catches the conditions that would abort a deploy midway.
- Every migration `0090`–`0094` self-asserts in a trailing `DO` block, so a half-applied gate fails at apply time.

Neither closes the underlying gap: **nothing yet alerts you that production is behind the repo.** A scheduled check comparing the deployed migration head against `supabase/migrations/` would.
