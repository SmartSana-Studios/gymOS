/**
 * Story 19.9b: recordRefund reads the guest session back after the insert and
 * reports what the server resolved (cancelled / used / kept); null for a
 * non-session payment and when the read-back finds nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let paymentRow: Record<string, unknown>;
let sessionRows: unknown[];
const reads: string[] = [];

function from(table: string) {
  reads.push(table);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "insert"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: paymentRow, error: null });
  b.single = async () => ({ data: { id: "refund-1" }, error: null });
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: sessionRows, error: null }).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1", sub: "u1" } }, error: null }) },
    from,
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })),
}));

const PAYMENT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

async function refund() {
  const { recordRefund } = await import("./payments");
  return recordRefund({ paymentId: PAYMENT_ID, amount: 2000, reason: "Guest asked for money back" });
}

describe("recordRefund session outcome", () => {
  beforeEach(() => {
    reads.length = 0;
    paymentRow = {
      id: PAYMENT_ID, gym_id: "gym-1", member_id: "m1", amount: 2000, currency: "XAF", status: "verified", purpose: "session",
    };
    sessionRows = [];
  });

  it.each([
    [{ consumed_at: null, voided_at: "2026-10-11T10:00:00Z" }, "cancelled"],
    [{ consumed_at: "2026-10-11T09:00:00Z", voided_at: null }, "used"],
    [{ consumed_at: null, voided_at: null }, "kept"],
  ])("reports %j as %s", async (row, outcome) => {
    sessionRows = [row];
    const result = await refund();
    expect(result.data?.sessionOutcome).toBe(outcome);
  });

  it("is null when the read-back finds no session", async () => {
    sessionRows = [];
    expect((await refund()).data?.sessionOutcome).toBeNull();
  });

  it("is null and skips the read-back for a non-session payment", async () => {
    paymentRow = { ...paymentRow, purpose: "subscription" };
    const result = await refund();
    expect(result.data?.sessionOutcome).toBeNull();
    expect(reads).not.toContain("guest_sessions");
  });
});
