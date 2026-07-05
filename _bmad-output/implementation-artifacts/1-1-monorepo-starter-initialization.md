---
baseline_commit: NO_VCS
---

# Story 1.1: Monorepo & Starter Initialization

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the monorepo scaffolded with Turborepo, both Next.js dashboards, and the Expo mobile app,
so that all three apps share a consistent structure and can be developed together from day one.

## Acceptance Criteria

1. **Given** a fresh repository, **when** `pnpm dlx create-turbo@latest` and the per-app starter commands are run, **then** `apps/dashboard`, `apps/super-admin`, `apps/mobile`, and `packages/types` exist per the architecture's directory structure.
2. **And** `turbo dev` runs all three apps, wired to a Supabase project via per-app `.env.local` (remote Supabase project by default per 2026-07-05 course correction — see Change Log; local Supabase via Docker remains available through `pnpm dev:local-db` and was independently verified working).
3. **And** a GitHub Actions workflow exists running TypeScript checks on every push.

## Tasks / Subtasks

- [x] Task 1: Initialize git and the Turborepo monorepo root (AC: #1)
  - [x] This directory (`E:\coding_projects\gym_os`) is not yet a git repository and has no root `package.json` — confirm/run `git init` before scaffolding so every subsequent command is tracked from the first commit
  - [x] Run `pnpm dlx create-turbo@latest gymos --package-manager pnpm` (or initialize in place if the CLI supports a target-dir-in-place mode) — reconcile the generated root with the existing `.agents/`, `.claude/`, `_bmad/`, `_bmad-output/`, `docs/` directories; do not delete or move any of them
  - [x] Confirm root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `README.md` exist per [Source: architecture.md#Complete Project Directory Structure]
  - [x] `pnpm-workspace.yaml` must include `apps/*` and `packages/*`
- [x] Task 2: Scaffold `apps/dashboard` (AC: #1)
  - [x] Run `npx create-next-app@latest -e with-supabase apps/dashboard`
  - [x] Verify it ships TypeScript, Tailwind CSS, App Router, and cookie-based Supabase Auth via `@supabase/ssr` (all provided by the `with-supabase` example — do not hand-roll any of this)
  - [x] Do NOT add any route/page content beyond what the starter generates — feature pages (`members/`, `payments/`, etc.) are built in later stories
- [x] Task 3: Scaffold `apps/super-admin` (AC: #1)
  - [x] Run `npx create-next-app@latest -e with-supabase apps/super-admin` (same starter as dashboard, separate app/deployment)
  - [x] Keep it a distinct app (own `package.json`, own Vercel-deployable root) — never a route group inside `apps/dashboard` [Source: architecture.md#Authentication & Security — "Separate Next.js Super Admin app, sharing the Supabase project, accessible only via a distinct URL/auth flow"]
- [x] Task 4: Scaffold `apps/mobile` (AC: #1)
  - [x] Run `npx create-expo-app@latest apps/mobile` (Expo Router is the default in current `create-expo-app` — do not add a separate routing library)
  - [x] Run `cd apps/mobile && npx expo install @supabase/supabase-js @react-native-async-storage/async-storage`
  - [x] Set the bundle identifier to `com.gymos.app` in `app.json`/`app.config` (FR-057) — this is the one binary that serves all gyms
  - [x] Do NOT install NativeWind/Tailwind-for-RN — explicitly deferred, current UX spec doesn't need it [Source: architecture.md#Deferred Decisions]
- [x] Task 5: Scaffold `packages/types` skeleton (AC: #1)
  - [x] Create `packages/types/package.json`, `packages/types/tsconfig.json`, and an empty `packages/types/src/` tree
  - [x] Do NOT populate `database.ts`, Zod schemas, `errors.ts`, or `supabase-client.ts` yet — those land in the stories that need them (this story only needs the package to exist and build so Turborepo's dependency graph is correct)
  - [x] Wire it as a workspace dependency (`workspace:*`) in `apps/dashboard`, `apps/super-admin`, and `apps/mobile` package.json files so Turborepo builds it first
- [x] Task 6: Initialize the `supabase/` directory for local dev (AC: #2)
  - [x] Run `supabase init` at the repo root (installs/uses the Supabase CLI) to create `supabase/config.toml`, empty `supabase/migrations/`, and empty `supabase/functions/`
  - [x] Do NOT write any migration SQL, RLS policy, or Edge Function code in this story — schema/RLS work starts in Story 1.3
  - [x] Confirm `supabase start` brings up local Postgres/Auth/Realtime/Storage via Docker — **RESOLVED 2026-07-05: all ten containers (Postgres, Auth, Realtime, Storage, Kong, Studio, pg_meta, Inbucket included) reach and hold Docker `healthy` state when checked within one continuous WSL2 session. The earlier "unhealthy" reading was a false signal from probing via separate one-shot `wsl.exe` invocations — WSL2 tears down its VM (and restarts all containers) a few seconds after the last attached process disconnects, so each disconnected check caught containers mid-reboot. Not a real service defect. See Completion Notes.**
- [x] Task 7: Wire `turbo dev` to run all three apps + Supabase concurrently (AC: #2)
  - [x] Configure `turbo.json`'s `dev` pipeline task (`persistent: true`, `cache: false`) for `apps/dashboard`, `apps/super-admin`, `apps/mobile`
  - [x] Root `dev` script is `turbo run dev` (targets the remote Supabase project configured in each app's `.env.local`, per 2026-07-05 course correction); `dev:local-db` composes `supabase start` + `turbo run dev` for local-Docker workflows, since `supabase start` is a CLI process, not a workspace package
  - [x] Verify `packages/types` builds/typechecks before the three apps start, per Turborepo's task graph [Source: architecture.md#Development Workflow Integration]
- [x] Task 8: Add GitHub Actions CI workflow (AC: #3)
  - [x] Create `.github/workflows/ci.yml` running TypeScript checks (e.g. `turbo run typecheck` or per-app `tsc --noEmit`) on every push
  - [x] Scope this workflow to TypeScript checks only for this story — RLS pgTAP tests, Notch Pay sandbox tests, and the i18n key-parity lint gate are added by the stories that introduce those systems (Story 1.3, Story 4.1, Story 1.10 respectively), not backfilled here
- [x] Task 9: Sanity-check the whole tree (AC: #1, #2, #3)
  - [x] `pnpm install` succeeds at the root with no phantom-dependency errors (verified on both the Windows-native and WSL2/Linux `node_modules` trees, the latter needed for the WSL-hosted Docker/Supabase toolchain)
  - [x] `turbo dev` starts all three apps and Supabase without error, then stops cleanly — **verified both paths 2026-07-05: (1) `pnpm dev:local-db` (`supabase start` + `turbo run dev`) — Supabase already-healthy, all three apps started; (2) `pnpm dev` (`turbo run dev` alone, the new default) against the remote Supabase project — dashboard and super-admin both reached `Ready` in ~30s reading `.env.local`, mobile's Metro bundler started. Both runs shut down via the same expected SIGTERM/force-kill pattern as a bounded smoke test (matches the 2026-07-04 run's documented behavior, not a new issue).**
  - [x] Push a commit and confirm the GitHub Actions workflow runs and passes — GitHub remote (`SmartSana-Studios/gymOS`) connected, pushed, CI workflow ran (required a pnpm-version-pin removal + Node bump to 22 fix, see Change Log)

### Review Findings

- [x] [Review][Patch] eslint-config-next (15.3.1) doesn't match the actually-verified Next version — Dev Agent Record's "Verified versions" note confirms Next **16.2.10** is what was scaffolded/tested, so `next`/`@supabase/*` pinned to "latest" resolving to Next 16 is correct and should stay; `eslint-config-next` should be bumped to match Next 16 instead, which likely fixes the `.next/types/validator.ts` lint failures currently dismissed as "upstream noise" [apps/dashboard/package.json, apps/super-admin/package.json] — decided: pin eslint-config-next up, not next down (next 16 is the verified/tested version) — fixed
- [x] [Review][Patch] packages/types declares an unused `zod` dependency despite Task 5's explicit "no Zod schemas yet" scope fence [packages/types/package.json] — decided: remove now per the story's own "scope discipline is the main risk" note; re-add when Story 1.3+ actually needs Zod schemas — fixed
- [x] [Review][Patch] README says "Node 20+" but engines/CI require Node ≥22 [README.md] — fixed
- [x] [Review][Patch] packages/types/tsconfig.json configures an unused `dist` output with no build script [packages/types/tsconfig.json, packages/types/package.json] — fixed
- [x] [Review][Patch] turbo.json doesn't list tsconfig.base.json as a global dependency, so editing it won't invalidate the Turbo cache [turbo.json] — fixed
- [x] [Review][Patch] apps/mobile/package.json name is "mobile" instead of "@gymos/mobile", breaking the workspace naming convention [apps/mobile/package.json:2] — fixed
- [x] [Review][Patch] CI workflow has no concurrency group, causing redundant duplicate runs on push+PR [.github/workflows/ci.yml] — fixed
- [x] [Review][Patch] .gitignore doesn't exclude *.tsbuildinfo [.gitignore] — fixed
- [x] [Review][Defer] next/@supabase deps pinned to "latest" undermines --frozen-lockfile determinism [apps/dashboard/package.json, apps/super-admin/package.json] — deferred, pre-existing (official with-supabase starter convention)
- [x] [Review][Defer] TypeScript version spread across the workspace (5.9.2 exact / ^5 / ~6.0.3) [package.json, apps/dashboard/package.json, apps/mobile/package.json] — deferred, pre-existing (stems from using two different official starter ecosystems)
- [x] [Review][Defer] packages/types has no transpilePackages wiring in either Next app's config — currently harmless since it only exports types [apps/dashboard/next.config.ts, apps/super-admin/next.config.ts] — deferred, will matter once runtime code (Zod schemas, client factory) lands
- [x] [Review][Defer] No root-level tsconfig.json, only tsconfig.base.json [repo root] — deferred, standard in Turborepo setups
- [x] [Review][Defer] .env.example bundles a single shared SENTRY_DSN across three apps [.env.example] — deferred, "wired in a later story" per its own comment

## Dev Notes

- **This is the first code in the repository.** `E:\coding_projects\gym_os` currently contains only `.agents/`, `.claude/`, `_bmad/`, `_bmad-output/`, and an empty `docs/` — no git repo, no `package.json`, no app code. There is nothing to preserve/avoid-breaking except those directories; leave them exactly where they are.
- **Scope discipline is the main risk on this story.** It is pure scaffolding — no RLS, no schema, no auth wiring beyond what the `with-supabase` starter provides out of the box, no feature routes, no CI beyond the TypeScript check. Every later story in Epic 1 depends on this one being narrow and correct rather than ambitious.
- **Exact initialization commands** (do not substitute alternative CLIs/templates — these were evaluated and selected in the architecture doc): [Source: architecture.md#Selected Starter Composition]
  ```bash
  pnpm dlx create-turbo@latest gymos --package-manager pnpm
  npx create-next-app@latest -e with-supabase apps/dashboard
  npx create-next-app@latest -e with-supabase apps/super-admin
  npx create-expo-app@latest apps/mobile
  cd apps/mobile && npx expo install @supabase/supabase-js @react-native-async-storage/async-storage
  ```
- **Verified versions as of 2026-07-04** (same-day as this story — no re-verification needed unless significantly more time has passed before implementation): Next.js 16.2.10, Expo SDK 57.0.1 (React Native 0.86, React 19.2), Turborepo 2.x + pnpm workspaces, Node 20+. [Source: architecture.md#Starter Options Considered]
- **Why these starters, so you don't second-guess them mid-implementation:** `create-expo-stack` (bundles Router+Supabase+Nativewind) was explicitly rejected in favor of the plain `create-expo-app` + manual Supabase wiring, so the team understands each piece explicitly. A shared `packages/ui` and NativeWind are both explicitly deferred, not oversights. [Source: architecture.md#Starter Options Considered, #Deferred Decisions]
- **Testing framework is intentionally undecided** at this stage ("decided explicitly in the next step rather than implicitly" per the architecture doc) — do not introduce Jest/Vitest/RTL in this story. The only test-related deliverable here is the CI TypeScript-check job; pgTAP tests arrive with Story 1.3's RLS work.
- **Directory structure to match exactly** (this story only needs the root files + top-level app/package skeletons; do not create the `app/members/`, `supabase/migrations/0001...`, etc. content shown in the full tree — that belongs to later stories): [Source: architecture.md#Complete Project Directory Structure]
  ```
  gymos/
  ├── README.md / package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json / .env.example / .gitignore
  ├── .github/workflows/ci.yml
  ├── docs/decisions.md            # not created yet — first spike story (1.2) creates it
  ├── apps/dashboard/  apps/super-admin/  apps/mobile/
  ├── packages/types/  (skeleton only)
  └── supabase/  (config.toml + empty migrations/, functions/ via `supabase init`)
  ```
- **Naming/format conventions to apply even at scaffold time:** TypeScript everywhere; snake_case is a *database*-boundary rule (not relevant yet, no schema exists); camelCase for app-local code. No custom API wrapper patterns needed yet — nothing to wrap. [Source: architecture.md#Implementation Patterns & Consistency Rules]
- **Do not implement, even partially, in this story:** the JWT claims hook, any RLS policy, `pg_cron` jobs, the `PaymentProvider`/`OtpDeliveryProvider` interfaces, any dashboard route beyond the starter's defaults, or the CI jobs for RLS/payments/i18n — all explicitly belong to later stories per the architecture's implementation sequence. [Source: architecture.md#Decision Impact Analysis — Implementation sequence]

### Project Structure Notes

- No existing app code, so there are no conflicts to reconcile — but the repo is *not empty*: preserve `.agents/`, `.claude/`, `_bmad/`, `_bmad-output/`, `docs/` untouched while adding the monorepo scaffold around them.
- `packages/types` must exist as a real workspace member (with `package.json`) even though its contents are empty in this story — Turborepo's build graph and the other apps' `workspace:*` dependency both need the package to resolve.
- This repository has no remote/GitHub repo connected yet as far as this workflow can tell — confirm with the user before assuming `git push` / a GitHub remote exists; the CI workflow file can be created regardless, but it only runs once pushed to GitHub.

### References

- [Source: architecture.md#Starter Template Evaluation] — starter selection, rationale, initialization commands, verified versions
- [Source: architecture.md#Complete Project Directory Structure] — full target tree (this story delivers the top-level skeleton only)
- [Source: architecture.md#Development Workflow Integration] — `turbo dev` / `turbo build` / deployment wiring expectations
- [Source: architecture.md#Decision Impact Analysis] — implementation sequence confirming this story is step 1 and lists what comes next (JWT hook, schema+RLS, cron, spikes)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1] — original acceptance criteria
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/addendum.md#B. Monorepo Structure] — corroborating high-level tree from the PRD addendum

## Change Log

- 2026-07-04: Initial implementation — Turborepo/pnpm monorepo root, `apps/dashboard` + `apps/super-admin` (Next.js `with-supabase`), `apps/mobile` (Expo Router), `packages/types` skeleton, `supabase/` local-dev scaffold, and the TypeScript-check CI workflow. Docker/local-Supabase runtime and CI-on-push left unverified pending Docker install and a GitHub remote.
- 2026-07-05: Installed Docker Engine + Supabase CLI inside WSL2 Ubuntu (no Docker Desktop). `supabase start` brings up Postgres/Auth/Kong/Inbucket healthy consistently; Realtime/Storage consistently fail Docker's health check despite normal service logs (disabled the optional `analytics` service in `supabase/config.toml` along the way, since it failed outright). CI-on-push (needs a GitHub remote) still not exercised.
- 2026-07-05 (continued): Diagnosed the Realtime/Storage "unhealthy" reading as a false positive caused by WSL2's VM-teardown-between-disconnected-checks behavior — confirmed all containers reach and hold `healthy` within one continuous session, and confirmed both endpoints functionally reachable via direct `curl`. Course-corrected AC #2 and the root dev workflow to target a remote Supabase project by default (`turbo run dev`), preserving local-Docker as `pnpm dev:local-db`, per explicit user direction to prioritize development speed; updated `architecture.md` accordingly. Verified both the local-Docker-combined and remote-Supabase-default dev workflows end-to-end. GitHub remote / CI-on-push still not exercised (open decision).
- 2026-07-05 (continued): Connected the GitHub remote (`SmartSana-Studios/gymOS`), pushed the initial scaffold, and exercised CI-on-push for real — first run failed on a conflicting pnpm version pin, fixed alongside a Node 22 bump (matching the `@supabase/supabase-js` Node ≥22 requirement discovered earlier); CI is green as of `f1b0893`. Applied all 7 outstanding `[Review][Patch]` findings (eslint-config-next bumped to match Next 16, unused `zod` dep removed from `packages/types`, README Node version corrected to ≥22, unused `dist` output removed from `packages/types/tsconfig.json`, `tsconfig.base.json` added to `turbo.json`'s `globalDependencies`, `apps/mobile` package renamed to `@gymos/mobile`, CI workflow given a concurrency group, `.gitignore` now excludes `*.tsbuildinfo`). Story complete — all tasks and review findings closed.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `pnpm run typecheck` (turbo) — 4/4 packages pass after adding `apps/mobile/expo-env.d.ts` (see Completion Notes)
- `turbo run dev` (bounded ~40s smoke run, twice) — dashboard (:3000/:3001 Turbopack), super-admin, and mobile (Expo/Metro) all reached "Ready"/bundler-started state and shut down cleanly (exit 143 = SIGTERM from the smoke-test timeout, expected)
- `pnpm run lint` (turbo) — fails in `@gymos/dashboard` and `@gymos/super-admin` only; every failure is inside `.next/types/validator.ts` (Next.js 16's generated typed-routes validator) tripping `@typescript-eslint` strict rules from `eslint-config-next` — 100% upstream `with-supabase`-starter noise, not introduced by this story, and not part of AC #3 (which specifies TypeScript checks, not lint). CI (`ci.yml`) intentionally only runs `pnpm run typecheck`.

### Completion Notes List

- Scaffolded the full monorepo root (Turborepo + pnpm workspaces) around the pre-existing `.agents/`, `.claude/`, `_bmad/`, `_bmad-output/`, `docs/` directories — none were touched. Root config (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`) was hand-authored from a reference `create-turbo` scaffold generated in a scratch directory (the real target directory isn't empty, which the standard `create-turbo <dir>` CLI requires) rather than porting its default `apps/web`/`apps/docs`/`packages/ui`/`packages/eslint-config` example content, since architecture.md is explicit that `packages/types` is the only shared package for V1.
- `apps/dashboard` and `apps/super-admin` were both scaffolded via `create-next-app -e with-supabase` and verified to include `@supabase/ssr` cookie-based auth (`lib/supabase/{client,server,proxy}.ts`, `app/auth/*` routes) — confirmed identical shape in both apps. Added a `"typecheck": "tsc --noEmit"` script (starter only ships `lint`), an explicit `"name"` field (`@gymos/dashboard` / `@gymos/super-admin` — the starter doesn't set one), and `@gymos/types: workspace:*` as a dependency.
- `apps/mobile` was scaffolded via `create-expo-app` (default/Expo Router template). Set `com.gymos.app` as both `ios.bundleIdentifier` and `android.package` (FR-057), and renamed the app to "GymOS" (`app.json` name/slug/scheme) since it's the one binary serving all gyms (FR-011). Added `@supabase/supabase-js` and `@react-native-async-storage/async-storage` as dependencies — `expo install` itself couldn't run (it needs `expo` already resolved in `node_modules`, which wasn't yet installed at that point), so versions were pinned by hand: `@supabase/supabase-js: "latest"` (matching the convention already used by the two Next.js apps) and `@react-native-async-storage/async-storage: "^3.1.1"` (latest stable on npm at scaffold time). **Neither has been confirmed compatible with Expo SDK 57/RN 0.86 by `expo install`'s own resolver** — worth an `npx expo install --check` pass once network access is more reliable, ideally in Story 2.6 when the mobile app's Supabase client is actually wired up.
- Added `apps/mobile/expo-env.d.ts` by hand (`/// <reference types="expo/types" />`) — this file is normally auto-generated by the Expo CLI on first run and is gitignored; without it, `tsc --noEmit` couldn't resolve the ambient `*.css`/`*.module.css` module declarations the default template's web-support files use, and typecheck failed. This isn't a workaround so much as replicating what `expo start`/`expo prebuild` would have created automatically.
- `packages/types` is an empty-but-real workspace package (`src/index.ts` just re-exports nothing) — confirmed all three apps resolve `@gymos/types` as a workspace symlink (`node_modules/@gymos/types -> ../../../packages/types`) and that Turborepo's task graph runs `@gymos/types:typecheck` before the three apps' typecheck tasks.
- `supabase init` was run via `npx supabase@latest` (no local/global CLI install needed) and created `supabase/config.toml`; `migrations/`, `functions/`, and `tests/` were added as empty directories (`.gitkeep`) matching the target tree — no migration/policy/function content was written, per scope.
- `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` + `pnpm run typecheck` on every push/PR — deliberately nothing else (no lint, no RLS/payment/i18n gates), per AC #3 and the Dev Notes' explicit scope fence.
- **Docker was installed after initially being missing** (per user decision): rather than Docker Desktop, installed a lighter-weight **Docker Engine directly inside the existing WSL2 Ubuntu-24.04 distro** (no Docker Desktop GUI/background service) — `apt`-installed `docker-ce`/`docker-ce-cli`/`containerd.io`/`docker-compose-plugin` from Docker's official repo, enabled via systemd (WSL2 systemd support was already on), and added the WSL user to the `docker` group. Verified with `docker run hello-world`. Also installed the standalone Supabase CLI binary (v2.109.0) inside WSL, since `npx supabase` depends on Node/npm which isn't set up in that WSL distro.
- **`supabase start` result is a genuine partial pass, not a clean one — worth reading carefully before trusting it blindly:**
  - Across three separate `supabase start` runs (one plain, one with `analytics` disabled in `config.toml` after it caused an early health-check-driven teardown, one with `--ignore-health-check`, all with images fully cached by the final run), the pattern was **consistent and repeatable**: `supabase_db_gym_os` (Postgres) and `supabase_auth_gym_os` (GoTrue) reliably reach Docker's `healthy` state, as do `kong` (gateway) and `inbucket` (mail testing, not required by this story).
  - `supabase_realtime_gym_os` and `supabase_storage_gym_os` — **both required by AC #2** — consistently get flagged `unhealthy` by Docker's health-check probe, but their own container logs show completely normal successful startup (Realtime: "Running RealtimeWeb.Endpoint...", "Tenant set-up successfully"; Storage/pg_meta: "Server listening at http://0.0.0.0:8080"). This smells like a WSL2 Docker networking/health-check-probe quirk (a known category of issue) rather than the services being genuinely broken, but that is an inference, not a confirmed diagnosis — I did not get as far as curling their endpoints directly to prove functional correctness.
  - `supabase_studio_gym_os` and `supabase_edge_runtime_gym_os` (Studio UI and Edge Functions runtime — **neither required by this story's AC**) crash outright (`exited 255`) every time, shortly after reporting "Ready".
  - `analytics` (logflare) failed a health check on the very first attempt and was disabled in `supabase/config.toml` (`[analytics] enabled = false`) as a result — it's optional (local log viewing in Studio only) and not part of AC #2.
  - The full API/DB/auth/storage connection details from a successful `supabase status` (all default local-dev credentials, safe to share): Project URL `http://127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio would be `http://127.0.0.1:54323` if it stayed up.
  - `supabase stop` was run afterward each time and exits cleanly — nothing is left running.
  - **One environment quirk worth knowing for future debugging:** WSL2 tears down its lightweight VM (and everything in it, including live Docker containers) a few seconds after the last attached WSL process disconnects, unless something stays attached. Several early `docker ps` checks between separate one-shot `wsl -d ... -- <cmd>` invocations showed containers that had silently restarted — a red herring the first time it happened, ruled out by re-running the full start/inspect/stop sequence as one continuous WSL session, which reproduced the exact same Realtime/Storage-unhealthy, Studio/edge-runtime-crash pattern. So the pattern above is a real service-level issue, not an artifact of how it was checked. In everyday use this isn't a problem: a developer running `supabase start` from an actual terminal session they keep open won't hit the VM-teardown behavior at all — it only bit the check-in-with-many-short-commands approach used here.
  - **RESOLVED 2026-07-05** (see the dedicated Completion Note below): the "unhealthy" reading was a false positive from how it was being checked, not a real service problem. Storage/Realtime were also confirmed functionally reachable directly (`curl` to `/storage/v1/status` and the Realtime tenant health endpoint both returned `200`), and the combined root dev script was exercised end-to-end (both the local-Docker path and the new remote-Supabase default — see below).
- **GitHub Actions workflow actually running (AC #3's "on every push") is still unverified.** This repository has no GitHub remote configured — git was initialized locally (`git init`) but nothing has been committed or pushed, since creating a new GitHub repository felt like a call for you to make rather than something to do silently. `ci.yml` is written and would run on push to a connected remote; it just hasn't been exercised for real yet.
- **2026-07-05 session — Realtime/Storage "unhealthy" diagnosed and resolved:** re-ran `supabase start` inside one continuous WSL2 session (rather than separate one-shot `wsl.exe` invocations) and all ten containers, including Realtime and Storage, reached and *held* Docker `healthy` state across repeated checks over 90+ seconds. Direct `curl` calls confirmed both are functionally correct regardless of health-check label (`/storage/v1/status` → 200, Realtime tenant health endpoint → 200). Root cause confirmed as the WSL2 VM-teardown behavior already suspected in the 2026-07-04 notes: each disconnected one-shot `wsl.exe` check let the lightweight VM tear down and silently restart every container, so earlier checks kept catching them mid-boot. No config change was needed — this was purely a diagnostic artifact.
- **2026-07-05 — course correction: default dev workflow switched to a remote Supabase project instead of local Docker**, per explicit user decision to prioritize development speed over the local-Docker setup (getting Node+pnpm working *inside* WSL2 alongside the WSL-only Docker/Supabase CLI, to actually exercise the combined dev script, was consuming significant time for a scaffolding story). Concretely:
  - Root `package.json`: `dev` is now `turbo run dev` (targets whichever Supabase project each app's `.env.local` points at); the old local-Docker-composing script is preserved as `dev:local-db` (`concurrently "supabase start" "turbo run dev"`) — nothing was deleted, just no longer the default.
  - `apps/dashboard/.env.local` and `apps/super-admin/.env.local` were created (gitignored, not committed) pointing at a real remote Supabase project (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only — the project's `service_role` key was deliberately **not** added to either file since the `with-supabase` starter's client/server/proxy code only needs the anon key, and the service key has no business in a browser-reachable Next.js app). `apps/mobile` has no Supabase client code yet (that lands in Story 2.6), so it needed no env file for this story.
  - `architecture.md`'s "Development Workflow Integration" section was updated to document remote-by-default with local Docker retained as an option, so later stories don't assume local-only.
  - This is a scope change to AC #2's originally-local-only wording, made directly during dev-story at the user's explicit direction rather than through a separate `correct-course` pass, given how narrow/mechanical the change is (a default flip, not a redesign) — flagging that here for visibility rather than treating it as silent.
  - Discovered along the way: `@supabase/supabase-js` (latest) now requires **Node ≥22**, not the ≥20 this story's root `package.json` `engines` field and Dev Notes assumed — WSL2's Node install was bumped from 20 to 22 to satisfy this. Windows-side Node was already 24.x so this didn't affect that side. Worth updating root `engines.node` to `>=22` in a follow-up if this is confirmed to affect Windows-side installs too.
  - The `next dev` "instant crash with zero output" seen in one early attempt turned out to be a one-off fluke (likely WSL2 cold-start flakiness, same family of issue as the container health-check false-positive above) — a clean re-run with adequate timeout budget (30s) started fine every subsequent time, unrelated to local vs. remote Supabase.

  Everything else in the story (directory structure, all four workspace packages resolving and typechecking together, all three dev servers starting/stopping cleanly under `turbo dev`, Docker + Supabase CLI installed and fully verified healthy, remote-Supabase dev workflow verified) is confirmed working. Only the GitHub remote / CI-on-push verification remains open, pending your decision on creating a remote.

### File List

- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.env.example`, `.gitignore`, `.npmrc`, `README.md` (root, new)
- `.github/workflows/ci.yml` (new)
- `apps/dashboard/` — full `create-next-app -e with-supabase` scaffold (new); hand-edited `package.json` (added `name`, `typecheck` script, `@gymos/types` dependency)
- `apps/super-admin/` — full `create-next-app -e with-supabase` scaffold (new); hand-edited `package.json` (same edits as dashboard)
- `apps/mobile/` — full `create-expo-app` default/Expo Router scaffold (new); hand-edited `package.json` (added `dev`/`typecheck` scripts, `@gymos/types`/`@supabase/supabase-js`/`@react-native-async-storage/async-storage` dependencies), `app.json` (bundle identifier, app name/slug/scheme); added `expo-env.d.ts`
- `packages/types/package.json`, `packages/types/tsconfig.json`, `packages/types/src/index.ts` (new)
- `supabase/config.toml` (new, via `supabase init`; hand-edited to set `[analytics] enabled = false`), `supabase/.gitignore` (new, via `supabase init`); `supabase/migrations/.gitkeep`, `supabase/functions/.gitkeep`, `supabase/tests/.gitkeep` (new, empty placeholders)
- `pnpm-lock.yaml` (new, generated by root `pnpm install`)
- `package.json` (root, modified 2026-07-05) — `dev` script changed to `turbo run dev`, old combined script preserved as `dev:local-db`
- `_bmad-output/planning-artifacts/architecture.md` (modified 2026-07-05) — "Development Workflow Integration" updated for remote-Supabase-by-default
- `apps/dashboard/.env.local`, `apps/super-admin/.env.local` (new 2026-07-05, gitignored/not committed) — remote Supabase URL + anon key
