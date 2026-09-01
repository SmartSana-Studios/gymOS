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
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
