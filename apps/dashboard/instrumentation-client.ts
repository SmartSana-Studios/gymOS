import posthog from "posthog-js";

// Confirmed current for Next.js 16.3.0 (apps/dashboard/node_modules/next/dist/docs/
// 01-app/03-api-reference/03-file-conventions/instrumentation-client.md) --
// this file runs after the HTML document loads, before hydration.

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (apiKey) {
  try {
    posthog.init(apiKey, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      // App Router client-side navigations don't re-trigger PostHog's default
      // pageview capture (a known gotcha, not optional) -- captured manually
      // below via onRouterTransitionStart instead.
      capture_pageview: false,
      // Review finding (AC #2): the default click/form-interaction
      // autocapture can pick up DOM text content (e.g. a member/staff name
      // rendered inside a clicked row or button), bypassing the closed
      // payload interfaces this story otherwise enforces. Disabled entirely
      // rather than scoped down -- user call.
      autocapture: false,
    });
    // Attached to every subsequent client-side event -- see next.config.ts
    // for why this reads NEXT_PUBLIC_ANALYTICS_ENV rather than VERCEL_ENV
    // directly.
    posthog.register({ environment: process.env.NEXT_PUBLIC_ANALYTICS_ENV ?? "dev" });
  } catch (err) {
    // Matches lib/analytics.ts's own non-blocking discipline: an analytics
    // failure must never break client hydration.
    console.error("[analytics] failed to initialize posthog-js", err);
  }
}

export function onRouterTransitionStart(url: string) {
  if (!apiKey) return;
  try {
    posthog.capture("$pageview", { $current_url: url });
  } catch (err) {
    console.error("[analytics] failed to capture $pageview", err);
  }
}
