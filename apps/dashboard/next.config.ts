import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { resolveAnalyticsEnvironment } from "./lib/analytics-environment";

const nextConfig: NextConfig = {
  // app/layout.tsx and app/(dashboard)/layout.tsx both read locale/auth
  // context inside explicit <Suspense> boundaries (Suspense-wrap fix
  // applied), so Cache Components no longer hard-fails a real `next build`.
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
  // VERCEL_ENV isn't NEXT_PUBLIC_-prefixed, so it isn't inlined into the
  // client bundle by default -- `env` here inlines it under a
  // NEXT_PUBLIC_ name so instrumentation-client.ts (Story 9.5) can tag
  // client-side PostHog events the same way lib/analytics.ts tags
  // server-side ones.
  env: {
    NEXT_PUBLIC_ANALYTICS_ENV: resolveAnalyticsEnvironment(),
  },
};

// Story 14.1: no SENTRY_AUTH_TOKEN/ORG/PROJECT exist in this repo's CI or
// local env (same gap PostHog's own no-DSN no-op already relies on) --
// `silent: true` keeps the source-map-upload step's absence from becoming a
// build warning-as-error, matching AC #2's "must not block CI or local dev".
export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
