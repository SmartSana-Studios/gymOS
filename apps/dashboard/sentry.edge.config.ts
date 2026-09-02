import * as Sentry from "@sentry/nextjs";
import { resolveAnalyticsEnvironment } from "./lib/analytics-environment";

// Story 14.1 (AC #2): mirrors lib/analytics.ts's own no-DSN-configured
// fallback -- must no-op safely, never block/crash local dev or CI.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  try {
    Sentry.init({
      dsn,
      environment: resolveAnalyticsEnvironment(),
    });
  } catch (err) {
    console.error("[sentry] failed to initialize", err);
  }
}
