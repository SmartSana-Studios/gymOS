/**
 * Story 4.13 (Task 5, AC #3): unit tests for `canOfferMobileMoneyPayment` --
 * the combined gate (platform kill switch AND gym connection status).
 * `isMobileMoneyInitiationEnabled()` itself is a pure env-var read, already
 * exercised indirectly via the 4 combinations below; this suite is the one
 * place all 4 states are asserted directly against the helper, rather than
 * only inferred from downstream callers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getGymPaymentConnectionStatus = vi.fn();

vi.mock("@/services/gym-payment-credentials", () => ({
  getGymPaymentConnectionStatus: (...args: unknown[]) => getGymPaymentConnectionStatus(...args),
}));

const ORIGINAL_ENV = process.env.TARAMONEY_INITIATION_ENABLED;

describe("canOfferMobileMoneyPayment", () => {
  beforeEach(() => {
    getGymPaymentConnectionStatus.mockReset();
    delete process.env.TARAMONEY_INITIATION_ENABLED;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.TARAMONEY_INITIATION_ENABLED;
    } else {
      process.env.TARAMONEY_INITIATION_ENABLED = ORIGINAL_ENV;
    }
  });

  it("enabled + connected -> true", async () => {
    getGymPaymentConnectionStatus.mockResolvedValue({
      data: { businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00Z" },
      error: null,
    });
    const { canOfferMobileMoneyPayment } = await import("./featureFlags");

    await expect(canOfferMobileMoneyPayment()).resolves.toBe(true);
  });

  it("enabled + not connected -> false", async () => {
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: null });
    const { canOfferMobileMoneyPayment } = await import("./featureFlags");

    await expect(canOfferMobileMoneyPayment()).resolves.toBe(false);
  });

  it("disabled (kill switch) + connected -> false, and never even queries the connection status", async () => {
    process.env.TARAMONEY_INITIATION_ENABLED = "false";
    const { canOfferMobileMoneyPayment } = await import("./featureFlags");

    await expect(canOfferMobileMoneyPayment()).resolves.toBe(false);
    expect(getGymPaymentConnectionStatus).not.toHaveBeenCalled();
  });

  it("disabled (kill switch) + not connected -> false", async () => {
    process.env.TARAMONEY_INITIATION_ENABLED = "false";
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: null });
    const { canOfferMobileMoneyPayment } = await import("./featureFlags");

    await expect(canOfferMobileMoneyPayment()).resolves.toBe(false);
  });

  it("a connection-status lookup failure ({data: null, error}) is treated the same as not connected -- false, not a throw", async () => {
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    const { canOfferMobileMoneyPayment } = await import("./featureFlags");

    await expect(canOfferMobileMoneyPayment()).resolves.toBe(false);
  });
});

describe("getMobileMoneyAvailability", () => {
  beforeEach(() => {
    getGymPaymentConnectionStatus.mockReset();
    delete process.env.TARAMONEY_INITIATION_ENABLED;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.TARAMONEY_INITIATION_ENABLED;
    } else {
      process.env.TARAMONEY_INITIATION_ENABLED = ORIGINAL_ENV;
    }
  });

  it("review fix (Story 4.13): distinguishes 'disabled', 'not_connected', and a real 'error' as 3 separate reasons -- not collapsed into one boolean", async () => {
    const { getMobileMoneyAvailability } = await import("./featureFlags");

    process.env.TARAMONEY_INITIATION_ENABLED = "false";
    await expect(getMobileMoneyAvailability()).resolves.toEqual({ available: false, reason: "disabled" });

    delete process.env.TARAMONEY_INITIATION_ENABLED;
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: null });
    await expect(getMobileMoneyAvailability()).resolves.toEqual({ available: false, reason: "not_connected" });

    const rpcError = { code: "unknown", message: "backend unavailable" };
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: rpcError });
    await expect(getMobileMoneyAvailability()).resolves.toEqual({ available: false, reason: "error", error: rpcError });

    getGymPaymentConnectionStatus.mockResolvedValue({
      data: { businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00Z" },
      error: null,
    });
    await expect(getMobileMoneyAvailability()).resolves.toEqual({ available: true });
  });
});
