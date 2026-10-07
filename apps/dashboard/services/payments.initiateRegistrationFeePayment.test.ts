/**
 * Story 18.3: unit tests for `initiateRegistrationFeePayment()` and
 * `getPendingRegistrationFeePayment()`. Mocks `@/lib/supabase/server`'s
 * `createClient()` with a stub, matching `payments.initiatePayment.test.ts`'s
 * convention for this same boundary.
 *
 * What matters here: the amount is NEVER sent (the RPC reads the gym fee), the
 * payer phone goes to the provider as bare digits, the provider is invoked
 * with the RPC's row, and an RPC refusal never reaches the provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let rpcResult: { data: { payment_id: string; provider_key: string }[] | null; error: unknown };
let invokeResult: { error: unknown };
let pendingRow: { id: string; created_at: string } | null;
let pendingError: unknown;

const rpc = vi.fn();
const invoke = vi.fn();
const eqCalls: Array<[string, unknown]> = [];
const isCalls: Array<[string, unknown]> = [];

function makeSupabaseStub() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return chain;
  });
  chain.is = vi.fn((column: string, value: unknown) => {
    isCalls.push([column, value]);
    return chain;
  });
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: pendingRow, error: pendingError }));
  return {
    auth: { getClaims: vi.fn(async () => claimsResult) },
    from: vi.fn(() => chain),
    rpc,
    functions: { invoke },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (e: unknown) => ({ code: "mapped", message: (e as { message?: string })?.message ?? "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string) => (key === "payments.errors.gymCredentialsUnavailable" ? "front desk fallback" : key),
  })),
}));

const VALID_INPUT = {
  memberId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  phoneNumber: "+237680811041",
};

describe("initiateRegistrationFeePayment", () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
    rpcResult = { data: [{ payment_id: "payment-1", provider_key: "taramoney" }], error: null };
    invokeResult = { error: null };
    rpc.mockImplementation(async () => rpcResult);
    invoke.mockImplementation(async () => invokeResult);
  });

  it("calls the RPC with only the member id -- no amount, no phone -- then invokes the provider with the RPC's row and a bare-digit payer phone", async () => {
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment(VALID_INPUT);

    expect(rpc).toHaveBeenCalledWith("initiate_registration_fee_payment", { p_member_id: VALID_INPUT.memberId });
    expect(invoke).toHaveBeenCalledWith("payment-webhook/initiate/taramoney", {
      body: { paymentId: "payment-1", phoneNumber: "237680811041" },
    });
    expect(result).toEqual({ data: { paymentId: "payment-1" }, error: null });
  });

  it("a payer phone different from the member's own is accepted and used as given", async () => {
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment({ ...VALID_INPUT, phoneNumber: "+221771234567" });

    expect(result.error).toBeNull();
    expect(invoke).toHaveBeenCalledWith("payment-webhook/initiate/taramoney", {
      body: { paymentId: "payment-1", phoneNumber: "221771234567" },
    });
  });

  it("an invalid E.164 payer phone is a validation_error and touches neither the RPC nor the provider", async () => {
    const { initiateRegistrationFeePayment } = await import("./payments");

    for (const phoneNumber of ["680811041", "237680811041", "+0123456789", "+23768", "not a phone", ""]) {
      const result = await initiateRegistrationFeePayment({ ...VALID_INPUT, phoneNumber });
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("validation_error");
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a malformed member id is a validation_error and touches neither the RPC nor the provider", async () => {
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment({ ...VALID_INPUT, memberId: "not-a-uuid" });

    expect(result.error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("an RPC refusal (e.g. already pending) is mapped and never reaches the provider", async () => {
    rpcResult = { data: null, error: { message: "registration_fee_already_pending: member x has a registration fee payment in progress" } };
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("registration_fee_already_pending");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("an RPC that returns no row is an error and never reaches the provider", async () => {
    rpcResult = { data: [], error: null };
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a gym_credentials_unavailable provider failure maps to the front-desk-fallback error", async () => {
    invokeResult = {
      error: new FunctionsHttpError({
        json: async () => ({ error: "payment provider initiation failed", code: "gym_credentials_unavailable" }),
      }),
    };
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "gym_credentials_unavailable", message: "front desk fallback" });
  });

  it("any other provider failure falls through to mapAndLog", async () => {
    invokeResult = { error: new Error("network unreachable") };
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "mapped", message: "network unreachable" });
  });

  it("an unreadable provider error body falls through to mapAndLog rather than throwing", async () => {
    invokeResult = {
      error: new FunctionsHttpError({
        json: async () => {
          throw new Error("not json");
        },
      }),
    };
    const { initiateRegistrationFeePayment } = await import("./payments");

    const result = await initiateRegistrationFeePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("mapped");
  });
});

describe("getPendingRegistrationFeePayment", () => {
  beforeEach(() => {
    eqCalls.length = 0;
    isCalls.length = 0;
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    pendingRow = { id: "payment-1", created_at: "2026-10-07T10:00:00Z" };
    pendingError = null;
  });

  it("returns the processing fee payment's id and createdAt, scoped to the gym, member, purpose and status", async () => {
    const { getPendingRegistrationFeePayment } = await import("./payments");

    const result = await getPendingRegistrationFeePayment("member-1");

    expect(result).toEqual({ data: { paymentId: "payment-1", createdAt: "2026-10-07T10:00:00Z" }, error: null });
    expect(eqCalls).toEqual([
      ["gym_id", "gym-1"],
      ["member_id", "member-1"],
      ["purpose", "registration_fee"],
      ["status", "processing"],
    ]);
    expect(isCalls).toEqual([["voided_at", null]]);
  });

  it("returns null data when nothing is processing", async () => {
    pendingRow = null;
    const { getPendingRegistrationFeePayment } = await import("./payments");

    const result = await getPendingRegistrationFeePayment("member-1");

    expect(result).toEqual({ data: null, error: null });
  });

  it("maps a query error", async () => {
    pendingRow = null;
    pendingError = { message: "boom" };
    const { getPendingRegistrationFeePayment } = await import("./payments");

    const result = await getPendingRegistrationFeePayment("member-1");

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "mapped", message: "boom" });
  });
});
