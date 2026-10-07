/**
 * Story 18.6: every Epic 18 audit action type has a label, and that label
 * resolves to real copy in both locales (not the raw key and not blank).
 * `registration_fee_exempt` is deliberately absent: it is metadata on a
 * member_created row, not an action type.
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "./auditLabels";

const EPIC_18_ACTION_TYPES = [
  "registration_fee_changed",
  "registration_fee_recorded",
  "registration_fee_waived",
  "registration_fee_paid",
  "registration_fee_attempt_expired",
  "registration_fee_late_payment",
  "registration_fee_voided",
  "member_plan_assigned",
];

function resolve(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

describe("audit labels for Epic 18 action types", () => {
  for (const actionType of EPIC_18_ACTION_TYPES) {
    it(`${actionType} has a label key that resolves in en and fr`, () => {
      const key = AUDIT_ACTION_TYPE_LABEL_KEY[actionType];
      expect(key, `no label key for ${actionType}`).toBeTruthy();

      const enLabel = resolve(en, key);
      const frLabel = resolve(fr, key);
      expect(typeof enLabel).toBe("string");
      expect((enLabel as string).trim()).not.toBe("");
      expect(typeof frLabel).toBe("string");
      expect((frLabel as string).trim()).not.toBe("");
      expect(frLabel).not.toBe(enLabel);
    });
  }

  it("does not label registration_fee_exempt, which is metadata and not an action type", () => {
    expect(AUDIT_ACTION_TYPE_LABEL_KEY["registration_fee_exempt"]).toBeUndefined();
  });
});
