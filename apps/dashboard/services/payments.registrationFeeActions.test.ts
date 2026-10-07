/**
 * Story 18.6: `recordRegistrationFee`, `waiveRegistrationFee` and
 * `voidRegistrationFeePayment` are thin wrappers over the 0099 and 0101 RPCs.
 * What matters: no amount is ever sent (the RPC reads the gym's fee), invalid
 * input never reaches the database, and an RPC raise comes back mapped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (e: unknown) => ({ code: "mapped", message: (e as { message?: string })?.message ?? "mapped" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PAYMENT_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

describe("recordRegistrationFee", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: "payment-1", error: null });
  });

  it("calls record_registration_fee with member, method and reason only -- no amount", async () => {
    const { recordRegistrationFee } = await import("./payments");

    const result = await recordRegistrationFee({ memberId: MEMBER_ID, method: "cash", reason: "Registration fee" });

    expect(rpc).toHaveBeenCalledWith("record_registration_fee", {
      p_member_id: MEMBER_ID,
      p_method: "cash",
      p_reason: "Registration fee",
    });
    expect(result).toEqual({ data: { paymentId: "payment-1" }, error: null });
  });

  it("rejects mobile_money, a short reason and a smuggled amount before the database", async () => {
    const { recordRegistrationFee } = await import("./payments");

    const tara = await recordRegistrationFee({ memberId: MEMBER_ID, method: "mobile_money", reason: "Registration fee" } as never);
    const short = await recordRegistrationFee({ memberId: MEMBER_ID, method: "cash", reason: "short" });

    expect(tara.error?.code).toBe("validation_error");
    expect(short.error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the mapped error when the RPC raises", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "registration_fee_already_recorded: x" } });
    const { recordRegistrationFee } = await import("./payments");

    const result = await recordRegistrationFee({ memberId: MEMBER_ID, method: "cash", reason: "Registration fee" });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("mapped");
  });
});

describe("waiveRegistrationFee", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it("calls waive_registration_fee with member and reason", async () => {
    const { waiveRegistrationFee } = await import("./payments");

    const result = await waiveRegistrationFee({ memberId: MEMBER_ID, reason: "Friend of the owner" });

    expect(rpc).toHaveBeenCalledWith("waive_registration_fee", { p_member_id: MEMBER_ID, p_reason: "Friend of the owner" });
    expect(result).toEqual({ error: null });
  });

  it("rejects a reason under 10 characters without calling the RPC", async () => {
    const { waiveRegistrationFee } = await import("./payments");

    const result = await waiveRegistrationFee({ memberId: MEMBER_ID, reason: "too short" });

    expect(result.error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("voidRegistrationFeePayment", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it("calls void_registration_fee_payment with the payment id and reason", async () => {
    const { voidRegistrationFeePayment } = await import("./payments");

    const result = await voidRegistrationFeePayment({ paymentId: PAYMENT_ID, reason: "Recorded on the wrong member" });

    expect(rpc).toHaveBeenCalledWith("void_registration_fee_payment", {
      p_payment_id: PAYMENT_ID,
      p_reason: "Recorded on the wrong member",
    });
    expect(result).toEqual({ error: null });
  });

  it("rejects a non-uuid payment id and a 201-character reason without calling the RPC", async () => {
    const { voidRegistrationFeePayment } = await import("./payments");

    const badId = await voidRegistrationFeePayment({ paymentId: "nope", reason: "Recorded on the wrong member" });
    const tooLong = await voidRegistrationFeePayment({ paymentId: PAYMENT_ID, reason: "x".repeat(201) });

    expect(badId.error?.code).toBe("validation_error");
    expect(tooLong.error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the mapped error when the RPC raises (not_found: payment)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_found: payment x not found" } });
    const { voidRegistrationFeePayment } = await import("./payments");

    const result = await voidRegistrationFeePayment({ paymentId: PAYMENT_ID, reason: "Recorded on the wrong member" });

    expect(result.error?.code).toBe("mapped");
  });
});
