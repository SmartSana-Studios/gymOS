import * as Sentry from "@sentry/nextjs";
import { assertNoUnprefixedInProduction } from "./lib/supabase/cookie-options";

// Story 14.1: instrumentation.ts works in both the Node and Edge runtimes --
// NEXT_RUNTIME selects which per-runtime Sentry config to load (Next.js
// docs, apps/dashboard/node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/instrumentation.md).
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

// AC #3: captures genuine-bug throws surfaced by the Next.js server itself
// (Server Components render, Route Handlers, Server Actions) -- the
// `{ data, error }` returns Server Actions/services already use for
// expected, user-facing errors never reach this hook.
export const onRequestError = Sentry.captureRequestError;
