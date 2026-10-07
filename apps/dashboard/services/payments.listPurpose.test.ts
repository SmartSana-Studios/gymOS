/**
 * Story 18.6: the Payments page names a registration fee, so
 * `listPendingPayments` and `listPaymentDiscrepancies` must select `purpose`
 * and carry it on every returned row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const selects: Array<[string, string]> = [];
let pendingRows: unknown[];
let discrepancyRows: unknown[];

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn((columns: string) => {
    selects.push([table, columns]);
    return builder;
  });
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(async () => ({ data: [], error: null }));
  builder.order = vi.fn(async () => ({
    data: table === "payment_discrepancies" ? discrepancyRows : pendingRows,
    error: null,
  }));
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-a" } }, error: null })) },
    from: vi.fn((table: string) => makeBuilder(table)),
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listPaymentDiscrepancies, listPendingPayments } from "./payments";

describe("payments list services carry purpose (Story 18.6)", () => {
  beforeEach(() => {
    selects.length = 0;
    pendingRows = [
      {
        id: "p1",
        member_id: "m1",
        amount: 5000,
        method: "cash",
        reason: "x",
        purpose: "registration_fee",
        created_at: "2026-10-01T00:00:00Z",
        actor_id: null,
        members: { name: "Ann", phone: null },
      },
    ];
    discrepancyRows = [
      {
        id: "d1",
        discrepancy_type: "stale_processing",
        details: {},
        detected_at: "2026-10-01T00:00:00Z",
        payments: { member_id: "m1", amount: 5000, currency: "XAF", purpose: "registration_fee", members: { name: "Ann" } },
      },
    ];
  });

  it("listPendingPayments selects purpose and returns it", async () => {
    const result = await listPendingPayments();

    const select = selects.find(([table]) => table === "payments")?.[1] ?? "";
    expect(select).toMatch(/\bpurpose\b/);
    expect(result.data?.[0].purpose).toBe("registration_fee");
  });

  it("listPaymentDiscrepancies selects the payment's purpose and returns it", async () => {
    const result = await listPaymentDiscrepancies();

    const select = selects.find(([table]) => table === "payment_discrepancies")?.[1] ?? "";
    expect(select).toMatch(/payments\([^)]*\bpurpose\b/);
    expect(result.data?.[0].purpose).toBe("registration_fee");
  });
});
