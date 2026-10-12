/**
 * Story 19.9b: the payments page passes chargeGuestsPerSession from gym
 * settings to PaymentsPageClient (it drives the AD-10 hint).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));
const listAllPayments = vi.fn();
vi.mock("@/services/payments", async () => {
  // Real filter normalisation so the page-to-normalizer chain is exercised.
  const real = await vi.importActual<typeof import("@/services/payments")>("@/services/payments");
  return {
    listPendingPayments: vi.fn(async () => ({ data: [], error: null })),
    listPaymentDiscrepancies: vi.fn(async () => ({ data: [], error: null })),
    listAllPayments: (...a: unknown[]) => listAllPayments(...a),
    PAYMENTS_LEDGER_PAGE_SIZE: 50,
    normalizeLedgerFilters: real.normalizeLedgerFilters,
  };
});
const getGymSettings = vi.fn();
vi.mock("@/services/gym-settings", () => ({ getGymSettings: (...a: unknown[]) => getGymSettings(...a) }));
vi.mock("@/services/session", () => ({
  getDashboardShellContext: vi.fn(async () => ({
    data: { memberName: "Rita", role: "owner" },
    error: null,
  })),
}));
vi.mock("./components/PaymentsPageClient", () => ({ PaymentsPageClient: () => null }));
vi.mock("./loading", () => ({ default: () => null }));

import PaymentsPage from "./page";

const MEMBER = "11111111-1111-4111-8111-111111111111";

async function render(
  sp: Record<string, string> = {},
): Promise<ReactElement<Record<string, unknown>>> {
  const boundary = PaymentsPage({ searchParams: Promise.resolve(sp) }) as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return (await (child.type as (p: unknown) => Promise<ReactElement>)(child.props)) as ReactElement<
    Record<string, unknown>
  >;
}

describe("payments page wiring (Story 19.9b)", () => {
  beforeEach(() => {
    getGymSettings.mockReset();
    getGymSettings.mockResolvedValue({ data: { chargeGuestsPerSession: false }, error: null });
    listAllPayments.mockReset();
    listAllPayments.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
  });

  it("passes chargeGuestsPerSession from gym settings, false when the read fails", async () => {
    getGymSettings.mockResolvedValue({ data: { chargeGuestsPerSession: true }, error: null });
    expect((await render()).props.chargeGuestsPerSession).toBe(true);

    getGymSettings.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    expect((await render()).props.chargeGuestsPerSession).toBe(false);
  });

  it("passes purpose, memberId and page to the ledger read (Story 19.9c)", async () => {
    const el = await render({ purpose: "session", memberId: MEMBER, page: "3" });
    expect(listAllPayments).toHaveBeenCalledWith({ purpose: "session", memberId: MEMBER, page: 3, pageSize: 50 });
    expect(el.props.ledgerPurpose).toBe("session");
    expect(el.props.ledgerMemberId).toBe(MEMBER);
  });

  it("falls back to all purposes for an unknown purpose param", async () => {
    const el = await render({ purpose: "junk" });
    expect(listAllPayments).toHaveBeenCalledWith(expect.objectContaining({ purpose: undefined, page: 1 }));
    expect(el.props.ledgerPurpose).toBe("");
  });

  it("drops a malformed memberId before it reaches the ledger read", async () => {
    const el = await render({ memberId: "not-a-uuid" });
    expect(listAllPayments).toHaveBeenCalledWith(expect.objectContaining({ memberId: undefined }));
    expect(el.props.ledgerMemberId).toBe("");
  });

  it("keeps the queue rendering when the ledger read fails", async () => {
    listAllPayments.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    const el = await render();
    expect(el.props.ledger).toBeNull();
    expect(el.props.ledgerError).toBe(true);
    expect(el.props.pendingPayments).toEqual([]);
  });
});
