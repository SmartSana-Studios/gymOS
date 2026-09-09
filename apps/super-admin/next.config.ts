import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // app/(admin)/layout.tsx, app/layout.tsx, and gyms/[id]/page.tsx all read
  // auth claims/locale inside explicit <Suspense> boundaries (Suspense-wrap
  // fix applied), so Cache Components no longer hard-fails a real `next
  // build`.
  cacheComponents: true,
  // Next 16 blocks cross-origin requests to dev-only endpoints, treating any
  // host other than the one the dev server initialized with (`localhost`) as
  // cross-origin. Browsing dev over `127.0.0.1` therefore got the HMR
  // WebSocket upgrade at `/_next/hmr` rejected with a malformed non-HTTP
  // response, which the browser reports as `ERR_INVALID_HTTP_RESPONSE`.
  // Because Turbopack's dev runtime bootstraps the client through that
  // socket, React then never hydrated: every page rendered as inert HTML, so
  // the login form fell through to a native GET and no auth request was ever
  // made. Dev-only; `next build` ignores it.
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
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
