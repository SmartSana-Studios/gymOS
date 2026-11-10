import { defineConfig, devices } from "@playwright/test";

// Story 13.5: this project's first E2E investment (ARCHITECTURE-SPINE.md's
// own Deferred section left "Playwright vs. other" unchosen -- this file
// resolves it). Drives a real, production-built dashboard
// (`next build && next start`, not `next dev` -- matches this project's own
// recurring "production build clean" verification discipline and avoids
// Fast Refresh overhead on an already-slow E2E job) against a real local
// Supabase instance. `.env.local` is loaded here (Node's built-in
// `process.loadEnvFile`, Node >=20.6 -- no new `dotenv` dependency) so
// fixtures/seed.ts and the specs' own `APIRequestContext` calls see the
// same `NEXT_PUBLIC_SUPABASE_URL`/keys the app itself uses; CI supplies the
// same fixed local-dev demo keys directly as job env vars instead (no
// `.env.local` file exists there).
try {
  // Relative to CWD, not import.meta.url: Playwright's own config loader
  // transpiles this file as CommonJS regardless of module/moduleResolution
  // in tsconfig.json, where import.meta is a syntax error. `playwright
  // test` is always invoked from apps/dashboard (this app's own
  // package.json script, and CI's `turbo run test:e2e --filter=dashboard`),
  // so a plain relative path is equivalent and avoids the ESM-only form.
  process.loadEnvFile(".env.local");
} catch (e) {
  // Only swallow "file doesn't exist" (e.g. CI, which sets these as real
  // job-level env vars instead) -- a real parse error in an existing
  // .env.local must surface here, not later as a confusing generic
  // missing-env-var failure once fixtures/seed.ts can't find a key it
  // expected process.loadEnvFile to have set.
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;
// Story 24.12: the landing app (public gym pages) is a second server. E2E_LANDING_PORT overrides the port when 3200 is taken on the machine; the spec reads the same variable.
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT ?? 3200);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // A real, shared local Supabase instance backs every spec (fixture rows
  // created by fixtures/seed.ts) -- concurrent specs booking/reassigning
  // the same fixture rows would race each other, unlike a typical
  // fully-isolated Playwright suite. One worker keeps this suite correct
  // over fast; revisit only if per-spec fixture isolation is added later.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/fixtures/seed.ts",
  globalTeardown: "./e2e/fixtures/teardown.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `pnpm build && pnpm exec next start --port ${PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    // Story 24.12: the public gym pages. A second Next app (apps/landing) built and started here, which also closes the "no landing build in CI"
    // deferral. Root domain `localhost`: the specs address a page by its Host header (`name.localhost`), no DNS. The reader is the real
    // `public_site_reader` role on the local database (its password is set by ci-local.sh / ci.yml before this runs). `url` is the Host-less root,
    // which the apex of `localhost` serves as the marketing site, so readiness does not depend on any page.
    {
      command: `pnpm --dir ../landing build && pnpm --dir ../landing exec next start --port ${LANDING_PORT}`,
      url: `http://127.0.0.1:${LANDING_PORT}/`,
      // never reuse: a landing server already on this port (e.g. one left by scripts/landing-gate/run-local.sh serve) has another reader password and
      // older code, and the spec would pass or fail against it. A busy port fails the run loudly instead.
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PUBLIC_SITE_ROOT_DOMAIN: "localhost",
        PUBLIC_SITE_MEDIA_ORIGIN: process.env.PUBLIC_SITE_MEDIA_ORIGIN ?? "http://127.0.0.1:54321",
        PUBLIC_SITE_REPORT_KEY: process.env.PUBLIC_SITE_REPORT_KEY ?? "e2e-report-key-0123456789",
        PUBLIC_SITE_READER_HOST: process.env.PUBLIC_SITE_READER_HOST ?? "127.0.0.1",
        PUBLIC_SITE_READER_PORT: process.env.PUBLIC_SITE_READER_PORT ?? "54322",
        PUBLIC_SITE_READER_DATABASE: process.env.PUBLIC_SITE_READER_DATABASE ?? "postgres",
        PUBLIC_SITE_READER_USER: process.env.PUBLIC_SITE_READER_USER ?? "public_site_reader",
        PUBLIC_SITE_READER_PASSWORD: process.env.PUBLIC_SITE_READER_PASSWORD ?? "",
      },
    },
  ],
});
