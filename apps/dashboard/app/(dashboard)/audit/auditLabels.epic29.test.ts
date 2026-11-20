/**
 * Story 29.2: the two class audit action types an Owner or Manager reads in the audit trail have a label that resolves in both locales (and
 * differs between them), and the Details wording exists in both, with a singular and a plural form.
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "./auditLabels";

const EPIC_29_ACTION_TYPES = ["class_times_changed", "class_cancelled"];

function resolve(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

describe("audit labels for Epic 29 action types", () => {
  for (const actionType of EPIC_29_ACTION_TYPES) {
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
    expect(resolve(en, AUDIT_ACTION_TYPE_LABEL_KEY.class_times_changed)).toBe("Class weekly times changed");
    expect(resolve(en, AUDIT_ACTION_TYPE_LABEL_KEY.class_cancelled)).toBe("Class cancelled");
    expect(resolve(fr, AUDIT_ACTION_TYPE_LABEL_KEY.class_times_changed)).toBe("Horaires du cours modifiés");
    expect(resolve(fr, AUDIT_ACTION_TYPE_LABEL_KEY.class_cancelled)).toBe("Cours annulé");
  });

  it("has the Details wording in both locales, singular and plural", () => {
    for (const key of [
      "audit.classTimes.details_one",
      "audit.classTimes.details_other",
      "audit.classCancelled.details_one",
      "audit.classCancelled.details_other",
    ]) {
      expect(typeof resolve(en, key), key).toBe("string");
      expect(typeof resolve(fr, key), key).toBe("string");
    }
  });
});
