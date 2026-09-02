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
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (confirmed current via
  `apps/dashboard/lib/supabase/client.ts`, `apps/super-admin/lib/supabase/client.ts`,
  `turbo.json`, and `.github/workflows/ci.yml` — root `.env.example` was
  reconciled to match, 2026-09-02; per-app `.env.example` files already
  had it right)
- `SUPABASE_SERVICE_ROLE_KEY`
- `DASHBOARD_APP_URL`
- Mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Expo
  names this pair differently from the Next.js apps above — confirmed via
  `apps/mobile/src/lib/supabase.ts`, not a typo), `EXPO_PUBLIC_APP_ENV`
  (set per EAS build profile in `eas.json`, not a loose env var)
- `NEXT_PUBLIC_SENTRY_DSN` (dashboard, super-admin), `EXPO_PUBLIC_SENTRY_DSN`
  (mobile) — Story 14.1 wired capture-only error monitoring, tagged with the
  same `VERCEL_ENV`/`EXPO_PUBLIC_APP_ENV` → `prod`/`staging`/`dev` convention
  as PostHog below. Real DSNs exist (see `docs/decisions.md`'s Story 14.1
  entry) but are only set in each app's gitignored local `.env.local` today
  — Sentry.init no-ops safely wherever the value is unset.
  `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` are optional,
  source-map-upload-only build-time vars, unset everywhere.
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
  the platform's own Tara Money credential set (used for Flow B/SaaS
  billing). Per-gym Tara Money credentials (FR-126) now exist as of Story
  4.13, stored per-gym in Supabase Vault rather than as env vars; see the
  2026-08-27 party-mode memlog and `docs/decisions.md`.
- `REVIEW_TEST_PHONE` — app-store review bypass phone number

**[NEEDS]** the Supabase Vault secret `platform:taramoney:business_id`
seeded in every environment (Story 4.16) — mirrors the value of this
project's own `TARAMONEY_BUSINESS_ID` Edge Function secret above, but read
from inside Postgres by `connect_gym_payment_credentials()` to reject a gym
connecting a `business_id_plain` that collides with the platform's own
account (see `docs/decisions.md`'s Story 4.16 entry). Seed once per
environment (local dev, CI, staging, prod) via:

```sql
select vault.create_secret('<value>', 'platform:taramoney:business_id');
```

Keep `<value>` in sync with that environment's `TARAMONEY_BUSINESS_ID`
secret — if they drift, the guard silently stops matching. If this secret
is unseeded in a given environment, the guard no-ops (connect succeeds as
before this story shipped) rather than blocking every connect attempt.

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
- No down-migrations convention exists — see §6 for the recommended
  forward-fix policy and the two open decisions (mobile hotfix strategy,
  production backup tier) that still need real answers before the first
  production migration run.

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
   **Confirmed passing on a real GitHub Actions runner as of 2026-09-02**
   (run [33668339830](https://github.com/SmartSana-Studios/gymOS/actions/runs/33668339830)).
   The first real run (33667259967) genuinely failed — not flakiness —
   with `e2e: missing required env var SUPABASE_SERVICE_ROLE_KEY` thrown
   from Playwright's `globalSetup`: `turbo.json`'s `test:e2e` task had no
   `env` allowlist declared, so Turborepo's default strict env mode
   stripped `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/
   `SUPABASE_SERVICE_ROLE_KEY`/`DASHBOARD_APP_URL` from the child process
   before the test suite ever saw them, even though they were genuinely
   set at the GitHub Actions step level. Fixed by declaring the same env
   list `build` already had. Now a real deploy gate.

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

### App layer

**Dashboard / Super Admin (Vercel):** every deploy is an immutable,
independently-addressable build — roll back via the Vercel dashboard
("Instant Rollback" on the Deployments tab) or `vercel rollback` from the
CLI, both of which repoint production traffic at a prior deployment
without a rebuild. This is close to instant. The one thing it does
**not** undo is a database migration applied alongside that deploy (see
below) — a schema change and its consuming code should be assumed to
travel together, so rolling back the app without also addressing the
migration can leave the old code pointed at a newer schema.

**Mobile (EAS / App Store / Play Store):** there is no fast path here —
**[NEEDS]** confirm before relying on any of this, but as of this writing
`apps/mobile` has no `expo-updates`/OTA channel configured (`app.json`,
`package.json` — grep-confirmed, 2026-09-02), so a bad release cannot be
patched over-the-air; every fix, including a rollback, is a new build
that goes back through platform review. The two real levers, both
slower than Vercel's:
- **Google Play:** if the production release uses a staged rollout
  (not yet decided — see §1's `eas.json` submit config, currently
  `track: "internal"`, not a production staged rollout), the rollout can
  be halted from Play Console before it reaches 100% of users.
- **Apple App Store:** a live release can be pulled from sale from App
  Store Connect, or a phased release paused within its first 7 days — it
  cannot be reverted to the prior binary; the only way back is
  submitting that prior version as a new build and waiting on review
  (or requesting expedited review for a critical fix).

Given this asymmetry, **[NEEDS]** a decision before the first store
submission: adopt `expo-updates` for JS-only hotfixes (the standard
mitigation for exactly this gap), or accept store-review turnaround as
the mobile rollback SLA.

### Database layer

This repo has no down-migration convention (see §3) and, for an
RLS/trigger-heavy Postgres schema like this one, hand-written down
migrations are themselves a real source of drift risk — they're rarely
exercised until the one time they're needed, and by then the schema has
usually moved further than the down migration accounts for. The
practical policy this runbook recommends:

1. **Forward-fix by default.** A bad migration is corrected by a new,
   reviewed migration that undoes or repairs the change — never by
   hand-editing the production schema or force-pushing history. This
   matches how this project already treats every other schema change
   (migrations are the source of truth, per §3).
2. **Data recovery is the production Supabase project's backup
   mechanism, not migration rollback.** Point-in-time recovery (PITR)
   and daily backups are Supabase *platform* features tied to the
   project's pricing tier — **[NEEDS]** confirm the tier the production
   project is created on and that PITR (or at minimum daily backups) is
   actually enabled before the first real migration runs against it; a
   Free-tier project has materially weaker guarantees here.
3. **Destructive migrations (`drop column`/`drop table`/irreversible
   data transforms) get a manual pre-flight step**: confirm a recent
   backup exists (or trigger one) immediately before applying, in
   addition to whatever the standard CI gates already checked in
   staging/local.

Do not treat this runbook as fully deploy-ready until the two
**[NEEDS]** above (mobile hotfix strategy, production Supabase backup
tier) have real answers — everything else in this section is a
documented, available mechanism, not a placeholder.

## 7. Observability

Sentry (NFR-007) is wired as of Story 14.1 across `apps/dashboard`,
`apps/super-admin`, and `apps/mobile` — unhandled exceptions (React error
boundaries, unhandled promise rejections, Server Action/Route
Handler/Server Component crashes) are captured and environment-tagged, but
only when `NEXT_PUBLIC_SENTRY_DSN`/`EXPO_PUBLIC_SENTRY_DSN` is actually set
for a given deploy. Real DSNs (3 Sentry projects, one organization —
`gymos-dashboard`, `gymos-super-admin`, `gymos-mobile`) exist and are
live-verified end-to-end. **Configured as of 2026-09-02**: both Vercel
projects (`gymos_dashboard`, `gymos-super-admin`, production + preview)
and the EAS `production` environment now have their real DSN set —
production error capture is active on all three apps as of the deploys/
builds made that day.
Edge Functions (`payment-webhook`, `send-sms-hook`, `gym-qr-display`) are
explicitly out of scope (a separate Deno SDK, a different runtime) and
still have no error monitoring — a genuine gap, not an oversight, tracked
as a follow-up. This story ships **capture only**: alerting rules, on-call
routing, and Sentry dashboards are still unbuilt, so even once a DSN is
set, a captured error will only surface via someone actively checking the
Sentry project, not a page/notification. Source-map upload (readable stack
traces in Sentry) also needs `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
`SENTRY_PROJECT` set, which is likewise unconfigured everywhere today —
on Vercel this degrades gracefully (`withSentryConfig({silent: true})`
just skips the upload); **on EAS it does not**: `@sentry/react-native/expo`'s
Xcode build phase hard-fails the entire iOS build with `XCODE_BUILD_ERROR`
when `SENTRY_ORG` is unset, discovered the hard way on this project's
first production build attempt (2026-09-02). Worked around by setting
`SENTRY_DISABLE_AUTO_UPLOAD=true` in the EAS `production` environment,
matching the same "capture only, no source maps yet" stance already
accepted for the two Next.js apps — **[NEEDS]** re-enable once a real
Sentry auth token is provisioned, since captured mobile errors will show
minified/unreadable stack traces until then. See `docs/decisions.md`'s
Story 14.1 entry and its 2026-09-02 mobile-build addendum. Until alerting
exists, a production incident will still only surface via a user report,
someone checking Sentry, or a manual `job_runs`/`audit_log` query.
PostHog is wired for product analytics (dashboard, mobile) but is not a
substitute for error tracking.
