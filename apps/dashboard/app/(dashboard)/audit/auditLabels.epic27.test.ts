/**
 * Story 27.3: the three staff check-in action types an Owner or Manager reads in the audit trail have a label that resolves in both
 * locales (and differs between them), and the per-action Details wording exists in both.
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "./auditLabels";

const EPIC_27_ACTION_TYPES = ["staff_check_in", "staff_check_in_rejected", "staff_check_in_voided", "subscription_plan_corrected"];

function resolve(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

describe("audit labels for Epic 27 action types", () => {
  for (const actionType of EPIC_27_ACTION_TYPES) {
    it(`${actionType} has a label key that resolves in en and fr`, () => {
      const key = AUDIT_ACTION_TYPE_LABEL_KEY[actionType];
      expect(key, `no label key for ${actionType}`).toBeTruthy();
      const enLabel = resolve(en, key);
      const frLabel = resolve(fr, key);
      expect(typeof enLabel).toBe("string");
      expect(typeof frLabel).toBe("string");
      expect(frLabel).not.toBe(enLabel);
    });
  }

  it("uses the UX wording", () => {
    expect(resolve(en, AUDIT_ACTION_TYPE_LABEL_KEY.staff_check_in)).toBe("Member checked in by staff");
    expect(resolve(en, AUDIT_ACTION_TYPE_LABEL_KEY.staff_check_in_rejected)).toBe("Staff check-in not accepted");
    expect(resolve(en, AUDIT_ACTION_TYPE_LABEL_KEY.staff_check_in_voided)).toBe("Staff check-in voided");
    expect(resolve(fr, AUDIT_ACTION_TYPE_LABEL_KEY.staff_check_in_rejected)).toBe("Arrivée par le personnel refusée");
    // Story 27.4
    expect(resolve(en, AUDIT_ACTION_TYPE_LABEL_KEY.subscription_plan_corrected)).toBe("Plan corrected");
    expect(resolve(fr, AUDIT_ACTION_TYPE_LABEL_KEY.subscription_plan_corrected)).toBe("Formule corrigée");
  });

  it("has the plan-correction Details wording in both locales", () => {
    for (const key of ["audit.planCorrection.details", "audit.planCorrection.expiry", "audit.planCorrection.noExpiry"]) {
      expect(typeof resolve(en, key), key).toBe("string");
      expect(typeof resolve(fr, key), key).toBe("string");
    }
  });

  it("has the Details wording in both locales, one reason per code the database writes", () => {
    for (const key of [
      "audit.staffCheckIn.checkedIn",
      "audit.staffCheckIn.checkedInWarning",
      "audit.staffCheckIn.voided",
      "audit.staffCheckIn.reason.expired",
      "audit.staffCheckIn.reason.no_paid_session",
      "audit.staffCheckIn.reason.deactivated",
      "audit.staffCheckIn.reason.registration_fee_due",
      "audit.staffCheckIn.reason.no_plan",
    ]) {
      expect(typeof resolve(en, key), key).toBe("string");
      expect(typeof resolve(fr, key), key).toBe("string");
    }
  });
});
