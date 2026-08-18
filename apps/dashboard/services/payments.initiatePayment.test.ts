/**
 * Story 4.14 (Task 3/4/7, AC #3): unit test for `initiatePayment()`'s new
 * handling of the payment-webhook Edge Function's typed
 * "credentials_not_connected" failure -- surfaced over the wire as a 502
 * with `{ code: "gym_credentials_unavailable" }`. Must map to a distinct,
 * front-desk-fallback AppError, not the generic `mapAndLog(invokeError)`
 * every other initiate() failure gets. Mocks `@/lib/supabase/server`'s
 * `createClient()` with a chainable query-builder stub, matching
 * `subscriptions.getRenewalPreview.test.ts`'s established convention for
 * this same boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let subscriptionRow: { plans: { price: number; currency: string } | null } | null;
let providerKeyResult: { data: string | null; error: unknown };
let insertedPaymentRow: { id: string } | null;
let insertError: unknown;
let invokeResult: { error: unknown };

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn((table: string) => {
      if (table === "subscriptions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({ data: subscriptionRow, error: null })),
                  })),
                })),
              })),
            })),
          })),
        };
      }
      // "payments"
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: insertedPaymentRow, error: insertError })),
          })),
        })),
      };
    }),
    rpc: vi.fn(async () => providerKeyResult),
    functions: {
      invoke: vi.fn(async () => invokeResult),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
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
  method: "mobile_money" as const,
};

describe("initiatePayment", () => {
  beforeEach(() => {
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    subscriptionRow = { plans: { price: 15000, currency: "XAF" } };
    providerKeyResult = { data: "taramoney", error: null };
    insertedPaymentRow = { id: "payment-1" };
    insertError = null;
    invokeResult = { error: null };
  });

  it("AC #3: a gym_credentials_unavailable Edge Function failure maps to a distinct, front-desk-fallback error", async () => {
    invokeResult = {
      error: new FunctionsHttpError({
        json: async () => ({ error: "payment provider initiation failed", code: "gym_credentials_unavailable" }),
      }),
    };
    const { initiatePayment } = await import("./payments");

    const result = await initiatePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "gym_credentials_unavailable", message: "front desk fallback" });
  });

  it("a generic (non-gym_credentials_unavailable) Edge Function failure still falls through to mapAndLog", async () => {
    invokeResult = {
      error: new FunctionsHttpError({
        json: async () => ({ error: "payment provider initiation failed" }),
      }),
    };
    const { initiatePayment } = await import("./payments");

    const result = await initiatePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });

  it("a non-FunctionsHttpError invoke failure (e.g. network error) falls through to mapAndLog, not the front-desk message", async () => {
    invokeResult = { error: new Error("network unreachable") };
    const { initiatePayment } = await import("./payments");

    const result = await initiatePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });

  it("an unparseable response body falls through to mapAndLog rather than throwing", async () => {
    invokeResult = {
      error: new FunctionsHttpError({
        json: async () => {
          throw new Error("not json");
        },
      }),
    };
    const { initiatePayment } = await import("./payments");

    const result = await initiatePayment(VALID_INPUT);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });

  it("a successful invoke still returns the paymentId as before", async () => {
    const { initiatePayment } = await import("./payments");

    const result = await initiatePayment(VALID_INPUT);

    expect(result).toEqual({ data: { paymentId: "payment-1" }, error: null });
  });
});
