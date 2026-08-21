/** Maps Vercel's own VERCEL_ENV to this story's env-tagging scheme (Dev Notes
 * "The Sentry Pattern This AC Points To Does Not Exist Yet") -- invented here
 * from scratch since no Sentry implementation exists yet to copy. Any future
 * Sentry work should adopt this same convention (docs/decisions.md).
 *
 * Review finding: kept dependency-free (no posthog-node import) in its own
 * file so next.config.ts can import it without pulling a third-party SDK's
 * import-time behavior into the build-time config graph -- lib/analytics.ts
 * re-exports it for server-side callers. */
export function resolveAnalyticsEnvironment(): "prod" | "staging" | "dev" {
  if (process.env.VERCEL_ENV === "production") return "prod";
  if (process.env.VERCEL_ENV === "preview") return "staging";
  return "dev";
}
