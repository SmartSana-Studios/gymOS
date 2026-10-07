/**
 * Story 18.5: the list badge. "Awaiting registration fee" appears only for a
 * member that is not deactivated, has not settled the fee, and has no
 * subscription. A SETTLED member with no plan keeps "no plan".
 */
import { describe, expect, it } from "vitest";

import { isAwaitingRegistrationFee, resolveBadgeStatus, STATUS_BADGE_CONFIG } from "./memberLabels";

const SETTLED = "2026-01-16T10:00:00Z";

describe("resolveBadgeStatus (Story 18.5)", () => {
  it("awaiting: fee unsettled and no subscription", () => {
    const row = { status: "no_active_plan" as const, deactivatedAt: null, registrationFeeSettledAt: null };
    expect(resolveBadgeStatus(row)).toBe("awaiting_registration_fee");
    expect(isAwaitingRegistrationFee(row)).toBe(true);
  });

  it("a settled member with no plan keeps no_active_plan", () => {
    const row = { status: "no_active_plan" as const, deactivatedAt: null, registrationFeeSettledAt: SETTLED };
    expect(resolveBadgeStatus(row)).toBe("no_active_plan");
    expect(isAwaitingRegistrationFee(row)).toBe(false);
  });

  it("deactivated wins over awaiting", () => {
    const row = { status: "no_active_plan" as const, deactivatedAt: "2026-02-01T00:00:00Z", registrationFeeSettledAt: null };
    expect(resolveBadgeStatus(row)).toBe("deactivated");
    expect(isAwaitingRegistrationFee(row)).toBe(false);
  });

  it("a member with a subscription shows its subscription status", () => {
    const row = { status: "active" as const, deactivatedAt: null, registrationFeeSettledAt: null };
    expect(resolveBadgeStatus(row)).toBe("active");
  });

  it("has a labelled, iconed badge config entry", () => {
    expect(STATUS_BADGE_CONFIG.awaiting_registration_fee.labelKey).toBe("members.status.awaitingRegistrationFee");
    expect(STATUS_BADGE_CONFIG.awaiting_registration_fee.icon).toBeDefined();
  });
});
