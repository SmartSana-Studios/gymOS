// Shared PostHog event-name and payload contracts for both apps/dashboard
// (posthog-node/posthog-js) and apps/mobile (posthog-react-native). Zero
// runtime dependencies -- do not import posthog-js/posthog-node/
// posthog-react-native here, matching this package's errors.ts precedent.

export const ANALYTICS_EVENT = {
  STAFF_CREATED: "staff_created",
  APP_OPENED: "app_opened",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT)[keyof typeof ANALYTICS_EVENT];

// Deliberate: every event payload interface below must stay a closed,
// named shape -- never a generic Record<string, unknown>/properties?: object
// escape hatch, and no member body-measurement or photo field may ever be
// added to any interface in this file (AC #2's guardrail for Epic 10).

export interface StaffCreatedEventProperties {
  gymId: string;
  role: string;
  isExistingAccount: boolean;
}

export interface AppOpenedEventProperties {
  gymId: string | null;
}
