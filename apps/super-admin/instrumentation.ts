import * as Sentry from "@sentry/nextjs";
import { assertNoUnprefixedInProduction } from "./lib/supabase/cookie-options";

// Story 14.1: mirrors apps/dashboard/instrumentation.ts.
export async function register() {
  // Story 24-3: refuse to start when the unprefixed-cookie dev gate is set in production.
  assertNoUnprefixedInProduction();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
