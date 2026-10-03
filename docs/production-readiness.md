# Production readiness

_Last updated: 2026-10-02._

A running, honest picture of what is deployed, what is proven, and what is not. Written so the next person does not have to reconstruct it — and specifically so the gap that opened this session (production five migrations behind, nobody aware) cannot open silently again.

## Current state

| | State | Verified how |
|---|---|---|
| **Database** | `0094` — at parity with the repo | Post-deploy checks on production: 21 guarded write-RPCs, 21 tables carrying `tenant_active_gate`, 0 policies granting manager without supervisor, separation trigger present |
| **Dashboard** | Deployed, on its final domain | `https://owner.gymosapps.com` — renamed from `app.` on 2026-10-02. For part of that day no route resolved (the DNS record for the new name was missing; `app.` had been detached; the Vercel URL 307'd to the dead host). DNS is in place now: `/auth/login` and `/privacy` both 200, the policy serving `hello.com` in both locales. Supabase auth `site_url`/allow-list were also still on the `vercel.app` hosts until 2026-10-02 — see Traps. |
| **Super Admin** | Deployed, on its final domain | `https://portal.gymosapps.com` (custom domain attached 2026-10-02; `super-admin-phi-jade.vercel.app` still resolves), Ready in Production |
| **Landing page** | In progress | `https://gymosapps.com` — `apps/landing`, added 2026-10-02 |
| **Mobile** | 1.0 live; **1.0.1 (build 16) submitted to both stores, awaiting the owner's publish clicks** | Live: App Store "GymOS Member App" (`id6798403711`, 1.0 build 15, released 2026-09-16) and Play "GymOS" (`com.smartsana.gymos`, build 15). Submitted 2026-10-02 from `8dfe223`: iOS build 16 uploaded to App Store Connect (Apple processing → TestFlight; **Submit for Review** on 1.0.1 is the owner's click); Android builds **16** and **17** are both on the Play **internal** track, release `COMPLETED` (**promote to production** is the owner's click). **17 is the first R8-shrunk build** (PR #27, for Play's DEX-optimisation warning) — 2fce5d0, 88 MB vs 16's 92 MB; it wants the Android device pass before promotion, and Play's re-score on its listing is the only confirmation the warning is cleared. The device pass from PR #8/#23 is still owed on this build. |
| **Deploys** | Automatic on push to `master` via Vercel Git integration | Four production builds observed following pushes |

Production data as of the deploy: **1 gym, 2 members, 3 auth users, 1 subscription, 0 payments.** Effectively empty — no customers to disrupt.

## What is proven, and what only looks proven

**Proven on production:** the schema. Every post-condition above was queried against the live database, not inferred from a passing local suite.

**Proven locally only:** behaviour. The pgTAP suite (94 files, 1964 assertions) and dashboard tests (308) all pass, and the schema now matches — but no suspended-gym denial has been exercised end to end *on production*. The local database and the production database have different data and different configuration.

**Specifically untested in production — the one to check first:** staff password reset by OTP. It works locally *because of the `test_otp` bypass in `supabase/config.toml`* (`+237670000001` → `123456`). Production has no such bypass; that path depends on the real Evolution API / Twilio chain being configured there, which has not been exercised. "It worked locally" does not carry over for this flow.

## Before onboarding a first client

1. **Role-by-role smoke test on production.** Create a gym → add staff of each role → sign in as each → add members → take a payment → onboard a member on mobile → check in → renew. Two total blockers were found this session by doing exactly this locally for twenty minutes; neither was caught by a green test suite.
2. ~~**A real domain.**~~ — **done (2026-10-02)**: `owner.gymosapps.com` (dashboard), `portal.gymosapps.com` (super-admin), `www.gymosapps.com` (landing; apex 308s to it). All three resolve and serve. Of the follow-ups: `DASHBOARD_APP_URL` reads `https://owner.gymosapps.com` on the dashboard project (verified via `vercel env pull`); on super-admin it is flagged *sensitive* and unreadable from the CLI, confirmed by the owner in the Vercel UI. The store-console privacy URL was re-pointed by the owner the same day (console-side, not verifiable from the repo). Supabase auth `site_url`/allow-list fixed via the management API — see Traps.
3. **Triage the 384 open items** in `deferred-work.md` into before/after first client. Nobody has done that pass. Most are minor; a few are not.
4. **12 Dependabot vulnerabilities (11 high)** on the default branch.

## Traps worth knowing

- **`supabase db push` is not safe here.** The CLI's container commands can fail silently and still exit 0 (`project_docker_no_network`). Deploy with `scripts/deploy-0090-0094.sh`'s pattern — host `psql`, one transaction per migration, version row written in the same transaction — and verify the head afterwards rather than trusting an exit code.
- **`.vercel/project.json` is stale.** It points at a project that returns "deleted, transferred, or you don't have access". The live projects are `gymos_dashboard` and `gymos-super-admin` under `josephfeussis-projects`. Any `vercel` CLI command run from the repo root targets the wrong thing.
- **`gymosdashboard.vercel.app` is not this app.** It serves a different site (title "GymOS - Ultimate Gym Management", with a `/login` route this repo does not have — ours is `/auth/login`, title "GymOS"). Do not share it as the product.
- **`docs/decisions.md` is newest-first**, so every new entry shifts every line number. Cite an entry's dated heading, never a line. This broke citations three stories running before the live ones were converted.
- **Supabase auth `site_url` and the redirect allow-list do not follow a domain move.** They are console-side config on the hosted project, and when the custom domains were attached they still named the two `vercel.app` hosts. GoTrue does not error on a `redirectTo` outside the allow-list — it **silently falls back to `site_url`** — so the dashboard's email password-reset (`forgot-password-form.tsx` passes `window.location.origin`) would have bounced through the old host, and super-admin's would have landed on the dashboard. Phone-OTP never touches this, which is why nothing surfaced it. Fixed 2026-10-02 via `PATCH /v1/projects/<ref>/config/auth`; audit with the matching `GET` after any host change.

## Why the drift happened, and what now prevents it

Production sat five migrations behind while CI was green, because CI tests the repo and nothing checks the deployed database against it. Two guards were added this session, both failing loudly rather than silently:

- `scripts/preflight-prod-deploy.sql` — read-only, reports PASS/WARN/STOP, and catches the conditions that would abort a deploy midway.
- Every migration `0090`–`0094` self-asserts in a trailing `DO` block, so a half-applied gate fails at apply time.

Neither closes the underlying gap: **nothing yet alerts you that production is behind the repo.** A scheduled check comparing the deployed migration head against `supabase/migrations/` would.
