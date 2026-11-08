import { appEnvironment } from "./app-env";

/** Identical VERCEL_ENV -> prod/staging/dev mapping as
 * apps/dashboard/lib/analytics-environment.ts (Story 9.5). apps/super-admin
 * has no copy of this function today -- excluded from PostHog by Story 9.5's
 * own design -- created fresh here for Sentry (Story 14.1). Duplicated
 * per-app rather than shared via packages/types, matching AD-10's existing
 * precedent that this repo's analytics/observability wrapper is duplicated
 * per-app on purpose, not abstracted. */
export function resolveAnalyticsEnvironment(env: Record<string, string | undefined> = process.env): "prod" | "staging" | "dev" {
  const appEnv = appEnvironment(env);
  if (appEnv === "production") return "prod";
  if (appEnv === "preview") return "staging";
  return "dev";
}
