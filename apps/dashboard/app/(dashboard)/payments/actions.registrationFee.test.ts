/**
 * Story 18.6: the record, waive, void and fee-state Server Actions. Each parses
 * its input with the shared schema (no amount field exists) and hands the parsed
 * value to the service; the RPC is the role authority, so there is no role check
 * here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordRegistrationFee = vi.fn();
const waiveRegistrationFee = vi.fn();
const voidRegistrationFeePayment = vi.fn();
const getMemberRegistrationFeeState = vi.fn();

vi.mock("@/services/payments", () => ({
  recordRegistrationFee: (...args: unknown[]) => recordRegistrationFee(...args),
  waiveRegistrationFee: (...args: unknown[]) => waiveRegistrationFee(...args),
  voidRegistrationFeePayment: (...args: unknown[]) => voidRegistrationFeePayment(...args),
  flagPayment: vi.fn(),
  getPendingMobileMoneyPayment: vi.fn(),
  getPendingRegistrationFeePayment: vi.fn(),
  initiatePayment: vi.fn(),
  initiateRegistrationFeePayment: vi.fn(),
  listRefundEligiblePayments: vi.fn(),
  logPaymentChange: vi.fn(),
  logRefundChange: vi.fn(),
  recordManualPayment: vi.fn(),
  recordRefund: vi.fn(),
  searchMembersForPayment: vi.fn(),
  verifyPayment: vi.fn(),
}));

vi.mock("@/services/members", () => ({
  getMemberRegistrationFeeState: (...args: unknown[]) => getMemberRegistrationFeeState(...args),
}));

vi.mock("@/lib/featureFlags", () => ({ getMobileMoneyAvailability: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PAYMENT_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

describe("registration fee Server Actions (Story 18.6)", () => {
  beforeEach(() => {
    recordRegistrationFee.mockReset().mockResolvedValue({ data: { paymentId: "p1" }, error: null });
    waiveRegistrationFee.mockReset().mockResolvedValue({ error: null });
    voidRegistrationFeePayment.mockReset().mockResolvedValue({ error: null });
    getMemberRegistrationFeeState.mockReset().mockResolvedValue({ data: { kind: "awaiting" }, error: null });
  });

  it("recordRegistrationFeeAction forwards the parsed input and drops an injected amount", async () => {
    const { recordRegistrationFeeAction } = await import("./actions");

    const result = await recordRegistrationFeeAction({
      memberId: MEMBER_ID,
      method: "cash",
      reason: "Registration fee",
      amount: 1,
    });

    expect(recordRegistrationFee).toHaveBeenCalledWith({ memberId: MEMBER_ID, method: "cash", reason: "Registration fee" });
    expect(result.data).toEqual({ paymentId: "p1" });
  });

  it("recordRegistrationFeeAction rejects mobile_money and invalid input before the service", async () => {
    const { recordRegistrationFeeAction } = await import("./actions");

    const tara = await recordRegistrationFeeAction({ memberId: MEMBER_ID, method: "mobile_money", reason: "Registration fee" });
    const junk = await recordRegistrationFeeAction("nope");

    expect(tara.error?.code).toBe("validation_error");
    expect(junk.error?.code).toBe("validation_error");
    expect(recordRegistrationFee).not.toHaveBeenCalled();
  });

  it("waiveRegistrationFeeAction forwards a valid input and rejects a short reason", async () => {
    const { waiveRegistrationFeeAction } = await import("./actions");

    const ok = await waiveRegistrationFeeAction({ memberId: MEMBER_ID, reason: "Friend of the owner" });
    const short = await waiveRegistrationFeeAction({ memberId: MEMBER_ID, reason: "short" });

    expect(ok.error).toBeNull();
    expect(waiveRegistrationFee).toHaveBeenCalledTimes(1);
    expect(short.error?.code).toBe("validation_error");
  });

  it("voidRegistrationFeeAction forwards a valid input and rejects a non-uuid payment id", async () => {
    const { voidRegistrationFeeAction } = await import("./actions");

    const ok = await voidRegistrationFeeAction({ paymentId: PAYMENT_ID, reason: "Recorded on the wrong member" });
    const bad = await voidRegistrationFeeAction({ paymentId: "nope", reason: "Recorded on the wrong member" });

    expect(ok.error).toBeNull();
    expect(voidRegistrationFeePayment).toHaveBeenCalledWith({ paymentId: PAYMENT_ID, reason: "Recorded on the wrong member" });
    expect(bad.error?.code).toBe("validation_error");
  });

  it("getMemberRegistrationFeeStateAction returns the service's state for the member", async () => {
    const { getMemberRegistrationFeeStateAction } = await import("./actions");

    const result = await getMemberRegistrationFeeStateAction(MEMBER_ID);

    expect(getMemberRegistrationFeeState).toHaveBeenCalledWith(MEMBER_ID);
    expect(result.data).toEqual({ kind: "awaiting" });
  });
});
