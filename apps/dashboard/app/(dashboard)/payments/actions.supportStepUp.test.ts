/**
 * Story 23-6c: a refund and a registration-fee waiver by a live support session need a fresh authenticator code, verified server
 * side and turned into a single-use grant bound to (action, subject) before the write. Staff roles are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordRefund = vi.fn();
const logRefundChange = vi.fn();
const waiveRegistrationFee = vi.fn();
const isLiveSupportSession = vi.fn();
const issueSupportStepUp = vi.fn();

vi.mock("@/services/payments", () => ({
  recordRefund: (...a: unknown[]) => recordRefund(...a),
  logRefundChange: (...a: unknown[]) => logRefundChange(...a),
  waiveRegistrationFee: (...a: unknown[]) => waiveRegistrationFee(...a),
}));
vi.mock("@/services/support-stepup", async (importActual) => ({
  ...(await importActual<typeof import("@/services/support-stepup")>()),
  isLiveSupportSession: () => isLiveSupportSession(),
  issueSupportStepUp: (...a: unknown[]) => issueSupportStepUp(...a),
}));
vi.mock("@/services/members", () => ({}));
vi.mock("@/lib/featureFlags", () => ({ getMobileMoneyAvailability: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PAYMENT_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";
const REFUND = { paymentId: PAYMENT_ID, amount: 1000, reason: "Charged twice by mistake" };
const WAIVE = { memberId: MEMBER_ID, reason: "Friend of the owner" };

beforeEach(() => {
  vi.clearAllMocks();
  isLiveSupportSession.mockResolvedValue(true);
  issueSupportStepUp.mockResolvedValue("issued");
  recordRefund.mockResolvedValue({ data: { id: "r1", memberId: MEMBER_ID, sessionOutcome: null }, error: null });
  logRefundChange.mockResolvedValue({ error: null });
  waiveRegistrationFee.mockResolvedValue({ error: null });
});

describe("recordRefundAction (support)", () => {
  it("issues a support_refund grant bound to the payment, then records the refund", async () => {
    const { recordRefundAction } = await import("./actions");

    const result = await recordRefundAction({ ...REFUND, authCode: "123456" });

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).toHaveBeenCalledWith({ action: "support_refund", subjectId: PAYMENT_ID, code: "123456" });
    expect(recordRefund).toHaveBeenCalledTimes(1);
    expect(issueSupportStepUp.mock.invocationCallOrder[0]).toBeLessThan(recordRefund.mock.invocationCallOrder[0]);
    // the code never travels into the service
    expect(JSON.stringify(recordRefund.mock.calls[0])).not.toContain("123456");
  });

  it.each([undefined, "", "abc123", "12345"])("a missing or malformed code (%s) is refused before any grant or write", async (authCode) => {
    const { recordRefundAction } = await import("./actions");

    const result = await recordRefundAction({ ...REFUND, authCode });

    expect(result.error?.code).toBe("code_required");
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(recordRefund).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_code", "invalid_code"],
    ["locked", "account_locked"],
    ["unavailable", "step_up_unavailable"],
  ])("a %s outcome writes nothing", async (outcome, code) => {
    issueSupportStepUp.mockResolvedValue(outcome);
    const { recordRefundAction } = await import("./actions");

    const result = await recordRefundAction({ ...REFUND, authCode: "123456" });

    expect(result.error?.code).toBe(code);
    expect(recordRefund).not.toHaveBeenCalled();
  });

  it("a staff role needs no code and never reaches the step-up", async () => {
    isLiveSupportSession.mockResolvedValue(false);
    const { recordRefundAction } = await import("./actions");

    const result = await recordRefundAction(REFUND);

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(recordRefund).toHaveBeenCalledTimes(1);
  });

  it("a replayed grant is refused by the database with its own error, which is passed through", async () => {
    recordRefund.mockResolvedValue({ data: null, error: { code: "step_up_required", message: "generic step-up message" } });
    const { recordRefundAction } = await import("./actions");

    const result = await recordRefundAction({ ...REFUND, authCode: "123456" });

    expect(result.error?.message).toBe("generic step-up message");
  });
});

describe("waiveRegistrationFeeAction (support)", () => {
  it("issues a support_waive_registration_fee grant bound to the member, then waives", async () => {
    const { waiveRegistrationFeeAction } = await import("./actions");

    const result = await waiveRegistrationFeeAction({ ...WAIVE, authCode: "123 456" });

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).toHaveBeenCalledWith({ action: "support_waive_registration_fee", subjectId: MEMBER_ID, code: "123 456" });
    expect(waiveRegistrationFee).toHaveBeenCalledWith(WAIVE);
  });

  it("a missing code is refused before any grant or write", async () => {
    const { waiveRegistrationFeeAction } = await import("./actions");

    const result = await waiveRegistrationFeeAction(WAIVE);

    expect(result.error?.code).toBe("code_required");
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(waiveRegistrationFee).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_code", "invalid_code"],
    ["locked", "account_locked"],
  ])("a %s outcome writes nothing", async (outcome, code) => {
    issueSupportStepUp.mockResolvedValue(outcome);
    const { waiveRegistrationFeeAction } = await import("./actions");

    const result = await waiveRegistrationFeeAction({ ...WAIVE, authCode: "123456" });

    expect(result.error?.code).toBe(code);
    expect(waiveRegistrationFee).not.toHaveBeenCalled();
  });

  it("a staff role is unchanged", async () => {
    isLiveSupportSession.mockResolvedValue(false);
    const { waiveRegistrationFeeAction } = await import("./actions");

    const result = await waiveRegistrationFeeAction(WAIVE);

    expect(result.error).toBeNull();
    expect(issueSupportStepUp).not.toHaveBeenCalled();
  });
});
