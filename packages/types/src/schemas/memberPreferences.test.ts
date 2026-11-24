import { describe, expect, it } from "vitest";

import { memberPreferencesUpdateSchema } from "./memberPreferences";

describe("memberPreferencesUpdateSchema", () => {
  it("accepts streakReminderOptedOut alone (Story 31.2), true or false", () => {
    expect(memberPreferencesUpdateSchema.safeParse({ streakReminderOptedOut: true }).success).toBe(true);
    expect(memberPreferencesUpdateSchema.safeParse({ streakReminderOptedOut: false }).success).toBe(true);
  });

  it("still accepts each of the older fields alone and together", () => {
    expect(memberPreferencesUpdateSchema.safeParse({ quietGymAlertsOptedOut: true }).success).toBe(true);
    expect(memberPreferencesUpdateSchema.safeParse({ classReminderOptedOut: false }).success).toBe(true);
    expect(memberPreferencesUpdateSchema.safeParse({ quietGymAlertsOptedOut: true, streakReminderOptedOut: true }).success).toBe(true);
  });

  it("still refuses an empty object and a non-boolean value", () => {
    expect(memberPreferencesUpdateSchema.safeParse({}).success).toBe(false);
    expect(memberPreferencesUpdateSchema.safeParse({ streakReminderOptedOut: "yes" }).success).toBe(false);
  });
});
