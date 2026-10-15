/**
 * Stories 20.1-20.4: every Epic 20 audit action type written so far has a label, and
 * that label resolves to real copy in both locales (not the raw key, not blank).
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "./auditLabels";

const EPIC_20_ACTION_TYPES = [
  "loyalty_program_changed",
  "loyalty_stamp_earned",
  "loyalty_reward_granted",
  "loyalty_progress_reset",
  "loyalty_stamp_reversed",
  "loyalty_free_session_lapsed",
  "loyalty_paid_session_lapsed",
  "loyalty_sweep_job_failure",
  "loyalty_hook_failed",
  "loyalty_hook_repaired",
];

function resolve(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

describe("audit labels for Epic 20 action types", () => {
  for (const actionType of EPIC_20_ACTION_TYPES) {
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

describe("subscriber loyalty events (Story 20.3)", () => {
  // The subscriber rule reuses the guest labels; counter 'subscriber' in the
  // metadata distinguishes them, so no new action type may appear.
  it("writes only action types that already have a label", () => {
    for (const actionType of ["loyalty_stamp_earned", "loyalty_reward_granted", "loyalty_progress_reset"]) {
      const key = AUDIT_ACTION_TYPE_LABEL_KEY[actionType];
      for (const locale of [en, fr]) {
        const label = resolve(locale, key);
        expect(typeof label).toBe("string");
        expect((label as string).trim()).not.toBe("");
        expect(label).not.toBe(key);
      }
    }
    const loyaltyKeys = Object.keys(AUDIT_ACTION_TYPE_LABEL_KEY).filter((k) => k.startsWith("loyalty_"));
    expect(loyaltyKeys.sort()).toEqual([...EPIC_20_ACTION_TYPES].sort());
  });
});
