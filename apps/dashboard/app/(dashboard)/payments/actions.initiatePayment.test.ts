/**
 * Story 4.12 (Task 2/3, AC #1, #4): unit tests for the new
 * `initiatePaymentAction` Server Action -- the first real UI-reachable
 * caller of `initiatePayment()` (built since Story 4.2, never wired to any
 * dashboard screen until this story). Covers the two things this action
 * itself is responsible for beyond a thin pass-through: the AC #4 kill
 * switch (`TARAMONEY_INITIATION_ENABLED`) and input validation -- the
 * underlying `initiatePayment()` service function's own behavior is Story
 * 4.2's concern, already covered there, and is mocked here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initiatePayment = vi.fn();

vi.mock("@/services/payments", () => ({
  initiatePayment: (...args: unknown[]) => initiatePayment(...args),
  // Other named exports actions.ts imports from this module -- unused by
  // initiatePaymentAction, stubbed only so the module doesn't fail to
  // resolve (matches actions.sendMemberInvite.test.ts's own precedent).
  flagPayment: vi.fn(),
  listRefundEligiblePayments: vi.fn(),
  logPaymentChange: vi.fn(),
  logRefundChange: vi.fn(),
  recordManualPayment: vi.fn(),
  recordRefund: vi.fn(),
  searchMembersForPayment: vi.fn(),
  verifyPayment: vi.fn(),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const VALID_INPUT = {
  memberId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  phoneNumber: "+237680811041",
  method: "mobile_money",
};

const ORIGINAL_ENV = process.env.TARAMONEY_INITIATION_ENABLED;

describe("initiatePaymentAction", () => {
  beforeEach(() => {
    initiatePayment.mockReset();
    delete process.env.TARAMONEY_INITIATION_ENABLED;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.TARAMONEY_INITIATION_ENABLED;
    } else {
      process.env.TARAMONEY_INITIATION_ENABLED = ORIGINAL_ENV;
    }
  });

  it("AC #1: with the flag unset (default), a valid input calls initiatePayment and returns its result", async () => {
    initiatePayment.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const { initiatePaymentAction } = await import("./actions");

    const result = await initiatePaymentAction(VALID_INPUT);

    expect(initiatePayment).toHaveBeenCalledWith(VALID_INPUT);
    expect(result).toEqual({ data: { paymentId: "payment-1" }, error: null });
  });

  it("AC #1: with the flag explicitly \"true\", behaves the same as unset", async () => {
    process.env.TARAMONEY_INITIATION_ENABLED = "true";
    initiatePayment.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const { initiatePaymentAction } = await import("./actions");

    const result = await initiatePaymentAction(VALID_INPUT);

    expect(initiatePayment).toHaveBeenCalledWith(VALID_INPUT);
    expect(result.error).toBeNull();
  });

  it("AC #4: with the flag set to the literal string \"false\", returns an error and never calls initiatePayment -- the kill switch", async () => {
    process.env.TARAMONEY_INITIATION_ENABLED = "false";
    const { initiatePaymentAction } = await import("./actions");

    const result = await initiatePaymentAction(VALID_INPUT);

    expect(initiatePayment).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });

  it("AC #4: the kill switch is checked before validation -- a malformed input under the disabled flag still returns the disabled error, not a validation error", async () => {
    process.env.TARAMONEY_INITIATION_ENABLED = "false";
    const { initiatePaymentAction } = await import("./actions");

    const result = await initiatePaymentAction({ memberId: "not-a-uuid" });

    expect(initiatePayment).not.toHaveBeenCalled();
    expect(result.error?.code).toBe("not_found");
  });

  it("returns a validation error for a malformed input, without calling initiatePayment", async () => {
    const { initiatePaymentAction } = await import("./actions");

    const result = await initiatePaymentAction({ memberId: "not-a-uuid", phoneNumber: "123", method: "" });

    expect(initiatePayment).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("validation_error");
  });

  it("propagates initiatePayment's own error result unchanged", async () => {
    initiatePayment.mockResolvedValue({ data: null, error: { code: "not_found", message: "no active provider" } });
    const { initiatePaymentAction } = await import("./actions");

    const result = await initiatePaymentAction(VALID_INPUT);

    expect(result).toEqual({ data: null, error: { code: "not_found", message: "no active provider" } });
  });
});
