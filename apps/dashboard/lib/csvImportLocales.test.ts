/**
 * Story 26.2: the import strings that carry numbers keep their placeholders in both languages, so a rewrite of the copy cannot
 * silently drop the count or the awaiting number the page passes in. (Key parity itself is checked by scripts/check-i18n-key-parity.mjs.)
 */
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

type Csv = { members: { csvImport: Record<string, string> & { errors: Record<string, string> } } };
const csv = (locale: unknown) => (locale as Csv).members.csvImport;

describe("members.csvImport strings (Story 26.2)", () => {
  for (const [name, locale] of [["en", en], ["fr", fr]] as const) {
    it(`${name}: the success toasts keep their placeholders`, () => {
      expect(csv(locale).importSuccessToast).toContain("{{count}}");
      expect(csv(locale).importSuccessToast).toContain("{{awaiting}}");
      expect(csv(locale).importSuccessToastPlain).toContain("{{count}}");
      expect(csv(locale).importSuccessToastPlain).not.toContain("{{awaiting}}");
    });

    it(`${name}: the no-plan line carries the row count`, () => {
      expect(csv(locale).noPlanSummary).toContain("{{count}}");
    });

    it(`${name}: the fee-0 warning, acknowledgement and refusal exist`, () => {
      expect(csv(locale).feeFreeWarning).toBeTruthy();
      expect(csv(locale).feeFreeAcknowledge).toBeTruthy();
      expect(csv(locale).errors.feeAckRequired).toBeTruthy();
    });
  }
});
