/**
 * Story 18.3: unit tests for `initiateRegistrationFeePaymentAction`. Like
 * `initiatePaymentAction` it is gated on the Tara Money kill switch and the
 * gym's own connection, but both "disabled" and "not connected" surface as
 * `no_active_provider`. The service function's own behavior is covered in
 * services/payments.initiateRegistrationFeePayment.test.ts and mocked here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initiateRegistrationFeePayment = vi.fn();
const getPendingRegistrationFeePayment = vi.fn();
const getGymPaymentConnectionStatus = vi.fn();

vi.mock("@/services/payments", () => ({
  initiateRegistrationFeePayment: (...args: unknown[]) => initiateRegistrationFeePayment(...args),
  getPendingRegistrationFeePayment: (...args: unknown[]) => getPendingRegistrationFeePayment(...args),
  // Other named exports actions.ts imports -- unused here, stubbed so the
  // module resolves.
  flagPayment: vi.fn(),
  getPendingMobileMoneyPayment: vi.fn(),
  initiatePayment: vi.fn(),
  listRefundEligiblePayments: vi.fn(),
  logPaymentChange: vi.fn(),
  logRefundChange: vi.fn(),
  recordManualPayment: vi.fn(),
  recordRefund: vi.fn(),
  searchMembersForPayment: vi.fn(),
  verifyPayment: vi.fn(),
}));

vi.mock("@/services/gym-payment-credentials", () => ({
  getGymPaymentConnectionStatus: (...args: unknown[]) => getGymPaymentConnectionStatus(...args),
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
};

const ORIGINAL_ENV = process.env.TARAMONEY_INITIATION_ENABLED;

describe("initiateRegistrationFeePaymentAction", () => {
  beforeEach(() => {
    initiateRegistrationFeePayment.mockReset();
    getGymPaymentConnectionStatus.mockReset();
    getGymPaymentConnectionStatus.mockResolvedValue({
      data: { businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00Z" },
      error: null,
    });
    delete process.env.TARAMONEY_INITIATION_ENABLED;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.TARAMONEY_INITIATION_ENABLED;
    } else {
      process.env.TARAMONEY_INITIATION_ENABLED = ORIGINAL_ENV;
    }
  });

  it("a valid input on a connected gym calls the service and returns its result", async () => {
    initiateRegistrationFeePayment.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const { initiateRegistrationFeePaymentAction } = await import("./actions");

    const result = await initiateRegistrationFeePaymentAction(VALID_INPUT);

    expect(initiateRegistrationFeePayment).toHaveBeenCalledWith(VALID_INPUT);
    expect(result).toEqual({ data: { paymentId: "payment-1" }, error: null });
  });

  it("with the kill switch off, returns no_active_provider (disabled copy) and never calls the service", async () => {
    process.env.TARAMONEY_INITIATION_ENABLED = "false";
    const { initiateRegistrationFeePaymentAction } = await import("./actions");

    const result = await initiateRegistrationFeePaymentAction(VALID_INPUT);

    expect(initiateRegistrationFeePayment).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "no_active_provider", message: "renewalPanel.errors.mobileMoneyDisabled" });
  });

  it("with the gym not connected, returns no_active_provider (not-connected copy) and never calls the service", async () => {
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: null });
    const { initiateRegistrationFeePaymentAction } = await import("./actions");

    const result = await initiateRegistrationFeePaymentAction(VALID_INPUT);

    expect(initiateRegistrationFeePayment).not.toHaveBeenCalled();
    expect(result.error).toEqual({ code: "no_active_provider", message: "renewalPanel.errors.mobileMoneyNotConnected" });
  });

  it("a real connection-status failure is propagated as-is, not reported as not connected", async () => {
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: { code: "unknown", message: "backend unavailable" } });
    const { initiateRegistrationFeePaymentAction } = await import("./actions");

    const result = await initiateRegistrationFeePaymentAction(VALID_INPUT);

    expect(initiateRegistrationFeePayment).not.toHaveBeenCalled();
    expect(result.error).toEqual({ code: "unknown", message: "backend unavailable" });
  });

  it("a malformed input is a validation_error and never calls the service", async () => {
    const { initiateRegistrationFeePaymentAction } = await import("./actions");

    const result = await initiateRegistrationFeePaymentAction({ memberId: "not-a-uuid", phoneNumber: "123" });

    expect(initiateRegistrationFeePayment).not.toHaveBeenCalled();
    expect(result.error?.code).toBe("validation_error");
  });

  it("an amount smuggled into the input is stripped before the service sees it", async () => {
    initiateRegistrationFeePayment.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const { initiateRegistrationFeePaymentAction } = await import("./actions");

    await initiateRegistrationFeePaymentAction({ ...VALID_INPUT, amount: 1 });

    expect(initiateRegistrationFeePayment).toHaveBeenCalledWith(VALID_INPUT);
  });

  it("propagates the service's own error result unchanged", async () => {
    initiateRegistrationFeePayment.mockResolvedValue({ data: null, error: { code: "registration_fee_already_pending", message: "wait" } });
    const { initiateRegistrationFeePaymentAction } = await import("./actions");

    const result = await initiateRegistrationFeePaymentAction(VALID_INPUT);

    expect(result).toEqual({ data: null, error: { code: "registration_fee_already_pending", message: "wait" } });
  });
});

describe("getPendingRegistrationFeePaymentAction", () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.TARAMONEY_INITIATION_ENABLED;
    } else {
      process.env.TARAMONEY_INITIATION_ENABLED = ORIGINAL_ENV;
    }
  });

  it("passes through to the service, not gated on the kill switch", async () => {
    process.env.TARAMONEY_INITIATION_ENABLED = "false";
    getPendingRegistrationFeePayment.mockResolvedValue({ data: { paymentId: "payment-1", createdAt: "2026-10-07T10:00:00Z" }, error: null });
    const { getPendingRegistrationFeePaymentAction } = await import("./actions");

    const result = await getPendingRegistrationFeePaymentAction("member-1");

    expect(getPendingRegistrationFeePayment).toHaveBeenCalledWith("member-1");
    expect(result.data).toEqual({ paymentId: "payment-1", createdAt: "2026-10-07T10:00:00Z" });
  });
});
