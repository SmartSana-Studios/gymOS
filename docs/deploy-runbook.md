# GymOS Deploy Runbook (DRAFT)

**Status: draft, assembled from the codebase's actual build tooling and CI
config — not yet exercised against a real production deploy target.**
No production hosting has been provisioned in this repo as of this
writing: there's no `vercel.json`, no recorded production Supabase
project, and no App Store / Play Store submission has shipped yet (an App
Store Connect app ID and a Play Store service-account path are configured
in `apps/mobile/eas.json`, but production `google-play-service-account.json`
is gitignored and not present in this checkout). Treat every `[NEEDS]`
below as a real open decision, not a formality — fill these in with
whoever owns the hosting accounts before the first real production deploy.

---

## 1. What ships

| App | Package | Ships as |
|---|---|---|
| Dashboard (staff-facing) | `apps/dashboard` (`@gymos/dashboard`) | Next.js app — `next build` / `next start` |
| Super Admin | `apps/super-admin` | Next.js app |
| Mobile (member-facing) | `apps/mobile` | Expo app — EAS build, submitted to App Store / Play Store |
| Database | `supabase/migrations/*` | Applied to a Supabase project via `supabase db push` |

Build orchestration is `turbo run build` (root `package.json`); each app's
own `build` script is `next build` (see `turbo.json`'s pipeline for the
env vars threaded into the dashboard build).

## 2. Environment variables required at build/runtime

Pulled from `turbo.json`'s `build` task env allowlist and `.github/workflows/ci.yml`
(the closest thing to a verified list this repo currently has —
`.env.example` is out of date and should be reconciled against this list
before publishing this runbook further):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (CI/turbo name — `.env.example`
  still says `NEXT_PUBLIC_SUPABASE_ANON_KEY`; **[NEEDS]** reconcile which
  is current)
- `SUPABASE_SERVICE_ROLE_KEY`
- `DASHBOARD_APP_URL`
- Mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  `EXPO_PUBLIC_APP_ENV` (set per EAS build profile in `eas.json`, not a
  loose env var)
- `SENTRY_DSN` — placeholder only; NFR-007 (Sentry wiring) is unstarted,
  see `docs/decisions.md`'s 2026-08-20 entry
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (dashboard, mobile
  — not super-admin, by design, see Story 9.5's Dev Notes)

Supabase project secrets (`supabase/.env`, gitignored, set via
`supabase secrets set` or the hosted project's dashboard in production —
**never** committed):

- `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY` — WhatsApp/Evolution API
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
  `TWILIO_WHATSAPP_FROM_NUMBER`, `TWILIO_WHATSAPP_CONTENT_SID` — SMS/WhatsApp OTP delivery
- `SENT_DM_API_KEY`, `SENT_DM_OTP_TEMPLATE_ID`
- `SEND_SMS_HOOK_SECRET` — Supabase Auth SMS-hook signing secret
- `TARAMONEY_API_KEY`, `TARAMONEY_BUSINESS_ID`, `TARAMONEY_WEBHOOK_SECRET` —
  payment provider. **Today this is one global credential set** — per-gym
  Tara Money credentials (FR-126) are not yet built; see the 2026-08-27
  party-mode memlog and `docs/decisions.md`.
- `REVIEW_TEST_PHONE` — app-store review bypass phone number

**[NEEDS]** a real secrets-management decision for production (Supabase
Vault was the agreed direction for the *per-gym* credentials once FR-126
ships — see `docs/decisions.md` — but the *platform-level* secrets above
still need an owner and a rotation policy).

## 3. Database migrations

- Pinned Supabase CLI version: **2.109.0** (see `.github/workflows/ci.yml`
  and root `package.json`'s `devDependencies.supabase` — keep these two in
  sync).
- Apply migrations to the target project: `supabase db push` (or
  `supabase migration up` against a linked project — confirm which is this
  team's convention before first use in production; neither has been
  exercised outside local `supabase start` yet).
- Migrations are the source of truth for schema — do not hand-edit a
  production schema outside a committed migration file.
- **[NEEDS]** confirm the rollback story: this repo has no down-migrations
  convention today. A bad migration on a production Supabase project needs
  either a forward-fix migration or a documented manual recovery step —
  decide and record this before the first real production migration run.

## 4. CI gates (must be green before deploy)

Three jobs in `.github/workflows/ci.yml`, triggered on every push and PR:

1. **`typecheck`** — typecheck, lint (incl. i18n hardcoded-string gate),
   i18n key-parity check, dashboard Vitest suite.
2. **`rls-tests`** — full pgTAP suite against a fresh local Supabase
   instance (`supabase start` + `supabase test db`).
3. **`e2e-tests`** (added by Story 13.5, 2026-09-01) — Playwright suite
   against a fresh local Supabase + dashboard build, covering staff
   provisioning, payment cutover (self-skips without real credentials),
   progress-data privacy, and class-booking capacity.
   **This job has not yet been confirmed to pass on a real GitHub Actions
   runner** — only local runs are verified as of this writing (see
   `_bmad-output/implementation-artifacts/deferred-work.md`). Confirm a
   green run on `origin/master` before treating this job as a real deploy
   gate.

## 5. Deploy steps (fill in once hosting is provisioned)

**[NEEDS]** — this section is intentionally a skeleton, not a guess:

1. Dashboard / Super Admin: **[NEEDS hosting target — Vercel is implied by
   `NEXT_PUBLIC`/`VERCEL_ENV`-based env-tagging conventions already in the
   codebase (`apps/dashboard/lib/analytics.ts`), but no `vercel.json` or
   linked project exists in this checkout — confirm and document the
   actual deploy trigger: git push to a Vercel-linked branch, or a manual
   `vercel --prod`]**.
2. Database: `supabase db push` against the production project (see §3).
3. Mobile: `eas build --profile production` then `eas submit` (App Store
   ascAppId `6798403711` and a Play Store internal track are already
   configured in `apps/mobile/eas.json`; confirm the `google-play-service-account.json`
   the submit profile references is actually provisioned before running this).
4. **[NEEDS]** post-deploy smoke test checklist — at minimum: staff login,
   a member check-in, a class booking, and a payment-webhook round-trip
   against production Tara Money credentials.

## 6. Rollback

**[NEEDS]** — no rollback procedure exists yet for either the app layer
(revert to prior Vercel/EAS build?) or the database layer (see §3's
migration rollback gap). Do not treat this runbook as deploy-ready until
this section has real answers.

## 7. Observability

There is currently **no production error monitoring** — Sentry (NFR-007)
is unstarted; see `docs/decisions.md`'s 2026-08-20 entry and
`.env.example`'s placeholder-only `SENTRY_DSN`. Until it's wired, a
production incident will only surface via a user report or a manual
`job_runs`/`audit_log` query, not an alert. PostHog is wired for product
analytics (dashboard, mobile) but is not a substitute for error tracking.
