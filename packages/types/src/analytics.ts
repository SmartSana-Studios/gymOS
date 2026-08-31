// Shared PostHog event-name and payload contracts for both apps/dashboard
// (posthog-node/posthog-js) and apps/mobile (posthog-react-native). Zero
// runtime dependencies -- do not import posthog-js/posthog-node/
// posthog-react-native here, matching this package's errors.ts precedent.

export const ANALYTICS_EVENT = {
  STAFF_CREATED: "staff_created",
  APP_OPENED: "app_opened",
  PROGRESS_ENTRY_LOGGED: "progress_entry_logged",
  WORKOUT_PLAN_EXERCISE_COMPLETED: "workout_plan_exercise_completed",
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

// Story 10.1: closed, named payload -- booleans/counts only, never a field
// carrying an actual weight/measurement/photo value. This is the sole
// structural enforcement of Epic 10's "no body-measurement or photo content
// in analytics" guardrail (docs/decisions.md ~line 29).
export interface ProgressEntryLoggedEventProperties {
  gymId: string;
  hasWeight: boolean;
  measurementCount: number; // 0-5, count only, never a value
  hasPhoto: boolean;
  hasNote: boolean;
  loggedOffline: boolean;
}

// Story 13.3: closed, minimal payload -- no exercise name/id (this domain
// has no body-measurement content to guard against, but keep the same
// closed-shape rigor ProgressEntryLoggedEventProperties establishes).
export interface WorkoutPlanExerciseCompletedEventProperties {
  gymId: string;
  loggedOffline: boolean;
}

// Review finding: without this mapping, `capture()` wrapper functions typed
// `properties` as `Record<string, unknown>`, so the closed interfaces above
// were defined but never actually enforced at the one place that matters --
// this ties each event name to its own named payload shape so a capture
// call site must pass the matching interface, not an arbitrary bag.
export interface AnalyticsEventProperties {
  [ANALYTICS_EVENT.STAFF_CREATED]: StaffCreatedEventProperties;
  [ANALYTICS_EVENT.APP_OPENED]: AppOpenedEventProperties;
  [ANALYTICS_EVENT.PROGRESS_ENTRY_LOGGED]: ProgressEntryLoggedEventProperties;
  [ANALYTICS_EVENT.WORKOUT_PLAN_EXERCISE_COMPLETED]: WorkoutPlanExerciseCompletedEventProperties;
}
