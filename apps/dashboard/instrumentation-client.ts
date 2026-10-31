import type { PostHog } from "posthog-js";
import * as Sentry from "@sentry/nextjs";
import { resolveAnalyticsEnvironment } from "./lib/analytics-environment";

// Confirmed current for Next.js 16.3.0 (apps/dashboard/node_modules/next/dist/docs/
// 01-app/03-api-reference/03-file-conventions/instrumentation-client.md) --
// this file runs after the HTML document loads, before hydration.

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// posthog-js is the largest script in the bundle (~200 KB), so it is fetched after the page has loaded and the
// browser is idle, never on the critical path of a slow connection. Pageviews that happen before it arrives wait
// on the same promise instead of being dropped.
let posthogReady: Promise<PostHog | null> | null = null;

function loadPosthog(): Promise<PostHog | null> {
  posthogReady ??= import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(apiKey as string, {
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
      return posthog;
    })
    .catch((err) => {
      // Matches lib/analytics.ts's own non-blocking discipline: an analytics
      // failure must never break client hydration.
      console.error("[analytics] failed to initialize posthog-js", err);
      return null;
    });
  return posthogReady;
}

if (apiKey && typeof window !== "undefined") {
  const start = () => void loadPosthog();
  if (document.readyState === "complete") {
    setTimeout(start, 2000);
  } else {
    window.addEventListener("load", () => setTimeout(start, 2000), { once: true });
  }
}

// Story 14.1 (AC #1, #2): mirrors PostHog's own no-DSN-configured guard
// immediately above -- Sentry.init must never run (and never throw) when no
// DSN is configured, e.g. local dev.
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (sentryDsn) {
  try {
    Sentry.init({
      dsn: sentryDsn,
      environment: resolveAnalyticsEnvironment(),
    });
  } catch (err) {
    console.error("[sentry] failed to initialize", err);
  }
}

// Composed export (Dev Notes "instrumentation-client.ts -- dashboard already
// has one, don't clobber it"): both PostHog's existing pageview capture and
// Sentry's own router-transition capture share this single exported hook
// rather than two conflicting exports of the same name.
export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  if (apiKey) {
    void loadPosthog().then((posthog) => {
      try {
        posthog?.capture("$pageview", { $current_url: url });
      } catch (err) {
        console.error("[analytics] failed to capture $pageview", err);
      }
    });
  }
  if (sentryDsn) {
    Sentry.captureRouterTransitionStart(url, navigationType);
  }
}
