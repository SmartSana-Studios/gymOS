import * as Sentry from "@sentry/nextjs";
import { resolveAnalyticsEnvironment } from "./lib/analytics-environment";

// Story 14.1 (AC #1, #2): apps/super-admin has no existing
// instrumentation-client.ts (excluded from PostHog by Story 9.5's own
// design) -- this file is Sentry-only, unlike apps/dashboard's composed
// version.
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

export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  if (sentryDsn) {
    Sentry.captureRouterTransitionStart(url, navigationType);
  }
}
