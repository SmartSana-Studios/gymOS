import PostHog from 'posthog-react-native';
import type { AnalyticsEventName, AnalyticsEventProperties } from '@gymos/types';

// AD-10 does not apply to PostHog (scoped only to payments/OTP/messaging) --
// a direct SDK wrapper is the correct amount of structure here, matching
// apps/dashboard/lib/analytics.ts's own reasoning.

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

// Review finding: a throwing constructor (malformed key, bad host, etc.)
// would previously crash root-layout import / app startup -- guarded to
// match this file's own "never throws" discipline below.
function createPosthogClient(): PostHog | null {
  if (!apiKey) return null;
  try {
    return new PostHog(apiKey, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST });
  } catch (err) {
    console.error('[analytics] failed to initialize posthog-react-native', err);
    return null;
  }
}

export const posthogClient = createPosthogClient();

/** Mirrors apps/dashboard/lib/analytics.ts's resolveAnalyticsEnvironment(),
 * but sourced from EXPO_PUBLIC_APP_ENV (set per EAS build profile in
 * eas.json, since mobile has no VERCEL_ENV equivalent) rather than
 * VERCEL_ENV -- see docs/decisions.md for why both apps share this same
 * dev/staging/prod convention. */
export function resolveAnalyticsEnvironment(): 'prod' | 'staging' | 'dev' {
  if (process.env.EXPO_PUBLIC_APP_ENV === 'production') return 'prod';
  if (process.env.EXPO_PUBLIC_APP_ENV === 'preview') return 'staging';
  return 'dev';
}

/** Never throws: an analytics failure must never fail the underlying
 * user-facing action, matching apps/dashboard/lib/analytics.ts's own
 * non-blocking discipline. `properties` is typed per `event` (review
 * finding: previously a generic `Record<string, unknown>`, undercutting the
 * closed payload interfaces in packages/types/src/analytics.ts). */
export function captureEvent<E extends AnalyticsEventName>(event: E, properties: AnalyticsEventProperties[E]): void {
  try {
    posthogClient?.capture(event, { ...properties, environment: resolveAnalyticsEnvironment() });
  } catch (err) {
    console.error(`[analytics] failed to capture event "${event}"`, err);
  }
}
