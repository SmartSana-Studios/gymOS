/**
 * Story 4.13 (Task 3, AC #1): unit tests for the gym-payment-credentials
 * service's 3 thin RPC wrappers. Mocks `@/lib/supabase/server`'s
 * `createClient()` with an `rpc()` stub, matching this codebase's
 * established convention for this boundary (`subscriptions.getRenewalPreview.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
const rpcMock = vi.fn(async () => rpcResult);

function makeSupabaseStub() {
  return { rpc: rpcMock };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

describe("getGymPaymentConnectionStatus", () => {
  beforeEach(() => {
    rpcResult = { data: null, error: null };
    rpcMock.mockClear();
  });

  it("returns the masked business id and connected date when a connection exists", async () => {
    rpcResult = { data: [{ business_id_masked: "•••• 1234", connected_at: "2026-08-17T00:00:00Z" }], error: null };
    const { getGymPaymentConnectionStatus } = await import("./gym-payment-credentials");

    const result = await getGymPaymentConnectionStatus("taramoney");

    expect(result).toEqual({
      data: { businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00Z" },
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith("get_gym_payment_connection_status", { p_provider_key: "taramoney" });
  });

  it("returns data: null (not an error) when zero rows come back -- not connected", async () => {
    rpcResult = { data: [], error: null };
    const { getGymPaymentConnectionStatus } = await import("./gym-payment-credentials");

    const result = await getGymPaymentConnectionStatus("taramoney");

    expect(result).toEqual({ data: null, error: null });
  });

  it("maps a real RPC error via mapAndLog", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const { getGymPaymentConnectionStatus } = await import("./gym-payment-credentials");

    const result = await getGymPaymentConnectionStatus("taramoney");

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});

describe("connectGymPaymentCredentials", () => {
  beforeEach(() => {
    rpcResult = { data: null, error: null };
    rpcMock.mockClear();
  });

  it("calls the RPC with the p_-prefixed args and returns no error on success", async () => {
    const { connectGymPaymentCredentials } = await import("./gym-payment-credentials");

    const result = await connectGymPaymentCredentials("taramoney", {
      apiKey: "key-1",
      businessId: "biz-1",
      webhookSecret: "secret-1",
    });

    expect(result).toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith("connect_gym_payment_credentials", {
      p_provider_key: "taramoney",
      p_api_key: "key-1",
      p_business_id: "biz-1",
      p_webhook_secret: "secret-1",
    });
  });

  it("maps a real RPC error (e.g. non-owner permission denied) via mapAndLog", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    const { connectGymPaymentCredentials } = await import("./gym-payment-credentials");

    const result = await connectGymPaymentCredentials("taramoney", {
      apiKey: "key-1",
      businessId: "biz-1",
      webhookSecret: "secret-1",
    });

    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});

describe("maskBusinessId", () => {
  it("reveals only the last 4 characters, prefixed with dots", async () => {
    const { maskBusinessId } = await import("./gym-payment-credentials");
    expect(maskBusinessId("9FmIZg9GBB")).toBe("•••• 9GBB");
  });

  it("trims surrounding whitespace before masking", async () => {
    const { maskBusinessId } = await import("./gym-payment-credentials");
    expect(maskBusinessId("  9FmIZg9GBB  ")).toBe("•••• 9GBB");
  });

  it("review fix (Story 4.13): a value of 4 characters or fewer is never partially revealed", async () => {
    const { maskBusinessId } = await import("./gym-payment-credentials");
    expect(maskBusinessId("abcd")).toBe("••••");
    expect(maskBusinessId("ab")).toBe("••••");
  });
});

describe("disconnectGymPaymentCredentials", () => {
  beforeEach(() => {
    rpcResult = { data: null, error: null };
    rpcMock.mockClear();
  });

  it("calls the RPC with the provider key and returns no error on success", async () => {
    const { disconnectGymPaymentCredentials } = await import("./gym-payment-credentials");

    const result = await disconnectGymPaymentCredentials("taramoney");

    expect(result).toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith("disconnect_gym_payment_credentials", { p_provider_key: "taramoney" });
  });

  it("maps a real RPC error via mapAndLog", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const { disconnectGymPaymentCredentials } = await import("./gym-payment-credentials");

    const result = await disconnectGymPaymentCredentials("taramoney");

    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});
