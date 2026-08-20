import type { NextConfig } from "next";
import { resolveAnalyticsEnvironment } from "./lib/analytics";

const nextConfig: NextConfig = {
  // app/layout.tsx and app/(dashboard)/layout.tsx both read locale/auth
  // context inside explicit <Suspense> boundaries (Suspense-wrap fix
  // applied), so Cache Components no longer hard-fails a real `next build`.
  cacheComponents: true,
  // VERCEL_ENV isn't NEXT_PUBLIC_-prefixed, so it isn't inlined into the
  // client bundle by default -- `env` here inlines it under a
  // NEXT_PUBLIC_ name so instrumentation-client.ts (Story 9.5) can tag
  // client-side PostHog events the same way lib/analytics.ts tags
  // server-side ones.
  env: {
    NEXT_PUBLIC_ANALYTICS_ENV: resolveAnalyticsEnvironment(),
  },
};

export default nextConfig;
