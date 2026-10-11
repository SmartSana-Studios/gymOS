/**
 * Story 19.3: every Epic 19 audit action type written so far has a label, and
 * that label resolves to real copy in both locales (not the raw key, not blank).
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "./auditLabels";

const EPIC_19_ACTION_TYPES = [
  "guest_charging_changed",
  "plan_type_changed",
  "plan_price_changed",
  "platform_session_config_updated",
];

function resolve(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

describe("audit labels for Epic 19 action types", () => {
  for (const actionType of EPIC_19_ACTION_TYPES) {
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
});
