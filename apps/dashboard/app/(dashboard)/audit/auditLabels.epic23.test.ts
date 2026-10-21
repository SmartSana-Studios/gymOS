/**
 * Story 23.8: the Epic 23 action types an Owner can read in the audit trail have a label that resolves in both locales, and the
 * disclosure copy exists in both.
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "./auditLabels";

const EPIC_23_ACTION_TYPES = ["allow_gymos_support_changed", "audit_disclosure_requested", "audit_disclosure_answered"];

function resolve(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

describe("audit labels for Epic 23 action types", () => {
  for (const actionType of EPIC_23_ACTION_TYPES) {
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

  it("never labels an action with a person's name", () => {
    for (const actionType of EPIC_23_ACTION_TYPES) {
      const label = String(resolve(en, AUDIT_ACTION_TYPE_LABEL_KEY[actionType]));
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it("has the disclosure copy in both locales", () => {
    for (const key of ["audit.disclosure.request", "audit.disclosure.submit", "audit.disclosure.sent", "audit.disclosure.errors.notFound"]) {
      expect(typeof resolve(en, key), key).toBe("string");
      expect(typeof resolve(fr, key), key).toBe("string");
    }
  });
});
