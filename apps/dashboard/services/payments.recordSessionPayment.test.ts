/**
 * Story 19.9b: `recordSessionPayment` is a thin wrapper over
 * record_session_payment (0108). No amount is ever sent (the RPC reads the
 * plan price), invalid input never reaches the database, and each of the
 * RPC's refusals comes back with its own code and message key.
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

describe("recordSessionPayment", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { id: "session-1" }, error: null });
  });

  it("calls record_session_payment with member, method and reason only -- no amount", async () => {
    const { recordSessionPayment } = await import("./payments");

    const result = await recordSessionPayment({ memberId: MEMBER_ID, method: "cash", reason: "Paid at desk" });

    expect(rpc).toHaveBeenCalledWith("record_session_payment", {
      p_member_id: MEMBER_ID,
      p_method: "cash",
      p_reason: "Paid at desk",
    });
    expect(result).toEqual({ data: { sessionId: "session-1" }, error: null });
  });

  it("omits the reason when none is given", async () => {
    const { recordSessionPayment } = await import("./payments");

    await recordSessionPayment({ memberId: MEMBER_ID, method: "manual_momo" });

    expect(rpc).toHaveBeenCalledWith("record_session_payment", {
      p_member_id: MEMBER_ID,
      p_method: "manual_momo",
      p_reason: undefined,
    });
  });

  it("rejects mobile_money, a 201-character note and a bad id before the database", async () => {
    const { recordSessionPayment } = await import("./payments");

    const tara = await recordSessionPayment({ memberId: MEMBER_ID, method: "mobile_money" } as never);
    const long = await recordSessionPayment({ memberId: MEMBER_ID, method: "cash", reason: "x".repeat(201) });
    const badId = await recordSessionPayment({ memberId: "nope", method: "cash" });

    expect(tara.error?.code).toBe("validation_error");
    expect(long.error?.code).toBe("validation_error");
    expect(badId.error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["permission denied", "permission_denied", "sessionPayment.errors.permissionDenied"],
    ["record_session_payment: invalid_method", "invalid_method", "sessionPayment.errors.invalidMethod"],
    ["record_session_payment: reason is too long", "reason_too_long", "sessionPayment.errors.reasonTooLong"],
    ["charging_disabled: this gym does not charge guests per session", "charging_disabled", "sessionPayment.errors.chargingDisabled"],
    ["not_found: member x not found", "not_found", "sessionPayment.errors.notFound"],
    ["member_deactivated: member x is deactivated", "member_deactivated", "sessionPayment.errors.memberDeactivated"],
    [
      "registration_fee_not_settled: member x has not settled the registration fee",
      "registration_fee_not_settled",
      "sessionPayment.errors.registrationFeeNotSettled",
    ],
    ["plan_not_per_session: member x is not on a pay-per-session plan", "plan_not_per_session", "sessionPayment.errors.planNotPerSession"],
    ["session_price_not_set: the pay-per-session plan has no price", "session_price_not_set", "sessionPayment.errors.sessionPriceNotSet"],
    [
      "session_payment_already_in_progress: member x has a session payment in progress",
      "session_payment_already_in_progress",
      "sessionPayment.errors.alreadyInProgress",
    ],
    ["session_config_missing: platform_session_config has no row", "session_config_missing", "sessionPayment.errors.configMissing"],
  ])("maps the refusal %s to its own code and message", async (raise, code, messageKey) => {
    rpc.mockResolvedValue({ data: null, error: { message: raise } });
    const { recordSessionPayment } = await import("./payments");

    const result = await recordSessionPayment({ memberId: MEMBER_ID, method: "cash" });

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code, message: messageKey });
  });

  it("sends a suspended-gym raise through the shared mapper", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "record_session_payment: gym 3fa85f64 is not active" },
    });
    const { recordSessionPayment } = await import("./payments");

    const result = await recordSessionPayment({ memberId: MEMBER_ID, method: "cash" });

    expect(result.error?.code).toBe("mapped");
  });
});
