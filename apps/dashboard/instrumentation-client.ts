import posthog from "posthog-js";

// Confirmed current for Next.js 16.3.0 (apps/dashboard/node_modules/next/dist/docs/
// 01-app/03-api-reference/03-file-conventions/instrumentation-client.md) --
// this file runs after the HTML document loads, before hydration.

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (apiKey) {
  posthog.init(apiKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    // App Router client-side navigations don't re-trigger PostHog's default
    // pageview capture (a known gotcha, not optional) -- captured manually
    // below via onRouterTransitionStart instead.
    capture_pageview: false,
  });
  // Attached to every subsequent client-side event -- see next.config.ts
  // for why this reads NEXT_PUBLIC_ANALYTICS_ENV rather than VERCEL_ENV
  // directly.
  posthog.register({ environment: process.env.NEXT_PUBLIC_ANALYTICS_ENV ?? "dev" });
}

export function onRouterTransitionStart(url: string) {
  if (!apiKey) return;
  posthog.capture("$pageview", { $current_url: url });
}
