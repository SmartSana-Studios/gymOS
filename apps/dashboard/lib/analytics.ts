import { PostHog } from "posthog-node";
import type { AnalyticsEventName, AnalyticsEventProperties } from "@gymos/types";
import { resolveAnalyticsEnvironment } from "./analytics-environment";

/** AD-10 does not apply to PostHog (scoped only to payments/OTP/messaging) --
 * a direct SDK wrapper is the correct amount of structure here, not a
 * swappable provider interface. */

export { resolveAnalyticsEnvironment };

// Module-scope singleton is correct here -- unlike lib/supabase/proxy.ts's
// per-request Supabase client (which is cookie/request-bound under Fluid
// compute), the PostHog Node client holds no per-request state, so a shared
// instance is the SDK's own recommended pattern for connection reuse.
let posthogNodeClient: PostHog | null = null;

function getPosthogNodeClient(): PostHog | null {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) {
    return null;
  }
  if (!posthogNodeClient) {
    posthogNodeClient = new PostHog(apiKey, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    });
  }
  return posthogNodeClient;
}

/** Captures a server-side event and flushes before returning -- Vercel
 * serverless functions can end before a background-timer flush fires, and
 * this codebase's Server Actions are always awaited to completion by their
 * caller, so an explicit await-flush here is sufficient (no waitUntil()
 * needed). Never throws: an analytics failure must never fail the
 * underlying user-facing operation, matching sendEvolutionApiMessage's own
 * non-blocking-side-effect discipline elsewhere in this codebase.
 *
 * `properties` is typed per `event` via `AnalyticsEventProperties` (review
 * finding: previously a generic `Record<string, unknown>`, which meant the
 * closed payload interfaces in packages/types/src/analytics.ts were defined
 * but never enforced at the one place that matters). */
export async function captureServerEvent<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEventProperties[E],
  distinctId?: string,
): Promise<void> {
  try {
    const client = getPosthogNodeClient();
    if (!client) {
      return;
    }
    client.capture({
      distinctId: distinctId ?? "server",
      event,
      properties: { ...properties, environment: resolveAnalyticsEnvironment() },
    });
    await client.flush();
  } catch (err) {
    console.error(`[analytics] failed to capture server event "${event}"`, err);
  }
}
