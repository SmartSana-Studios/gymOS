import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // app/(admin)/layout.tsx, app/layout.tsx, and gyms/[id]/page.tsx all read
  // auth claims/locale inside explicit <Suspense> boundaries (Suspense-wrap
  // fix applied), so Cache Components no longer hard-fails a real `next
  // build`.
  cacheComponents: true,
  // @gymos/types gained real runtime code in Story 1.5 (Zod schemas,
  // mapSupabaseError) — previously `export {}` only, so this was harmless to
  // omit (flagged as deferred in Story 1.1's review). Now load-bearing:
  // without it, Next.js won't transpile the workspace package's TS source.
  transpilePackages: ["@gymos/types"],
};

// Story 14.1: mirrors apps/dashboard/next.config.ts's own rationale -- no
// SENTRY_AUTH_TOKEN/ORG/PROJECT exist in this repo's CI or local env,
// `silent: true` keeps the source-map-upload step's absence from becoming a
// build warning-as-error (AC #2).
export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
