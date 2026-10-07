/**
 * Story 18.3 and 18.4: mapSupabaseError()'s registration-fee mappings (0099 record/
 * waive, 0100 initiate). Pins the stable codes the dashboard screens in Story
 * 18.6 will switch on, in both locales, and that a suspended gym still wins.
 *
 * Lives here, not in packages/types, because that package has no test runner
 * (see errors.gymSuspended.test.ts).
 */
import { describe, expect, it } from "vitest";
import { mapSupabaseError } from "@gymos/types";

const MEMBER = "00000000-0000-0000-0000-000000009921";
const GYM = "00000000-0000-0000-0000-000000009922";

const CASES: Array<[string, string]> = [
  [`registration_fee_already_pending: member ${MEMBER} has a registration fee payment in progress`, "registration_fee_already_pending"],
  [`registration_fee_already_recorded: member ${MEMBER} already has a registration fee payment`, "registration_fee_already_recorded"],
  [`registration_fee_not_due: member ${MEMBER} has no registration fee outstanding`, "registration_fee_not_due"],
  [`registration_fee_not_configured: gym ${GYM} charges no registration fee`, "registration_fee_not_configured"],
  ["initiate_registration_fee_payment: no_active_provider", "no_active_provider"],
  [`not_found: member ${MEMBER} not found`, "member_not_found"],
  [`member_deactivated: member ${MEMBER} is deactivated`, "member_deactivated"],
  [`tara_fee_cannot_be_voided: payment ${MEMBER} was collected through Tara Money`, "tara_fee_cannot_be_voided"],
  [`member_already_has_subscription: member ${MEMBER} already has a subscription`, "member_already_has_subscription"],
  [`registration_fee_not_refundable: payment ${MEMBER} is a registration fee, which is not refundable`, "registration_fee_not_refundable"],
  [`payment_voided_not_refundable: payment ${MEMBER} was voided and cannot be refunded`, "payment_voided_not_refundable"],
];

describe("mapSupabaseError -- registration fee (Story 18.3)", () => {
  for (const [message, code] of CASES) {
    it(`maps "${message.split(":")[0]}" to ${code} with real copy in both locales`, () => {
      const en = mapSupabaseError({ message }, "en");
      const fr = mapSupabaseError({ message }, "fr");

      expect(en.code).toBe(code);
      expect(fr.code).toBe(code);
      expect(en.message).not.toBe("Something went wrong on our end.");
      expect(fr.message).not.toBe(en.message);
    });
  }

  it("a suspended gym's raise still maps to gym_suspended, not a fee code", () => {
    const result = mapSupabaseError({ message: `initiate_registration_fee_payment: gym ${GYM} is not active` }, "en");

    expect(result.code).toBe("gym_suspended");
  });

  it("the existing renewal deactivated mapping is unchanged", () => {
    const result = mapSupabaseError({ message: "renew_subscription: member x is deactivated and cannot be renewed" }, "en");

    expect(result.code).toBe("member_deactivated");
    expect(result.message).toBe("This member is deactivated and cannot be renewed.");
  });
});
