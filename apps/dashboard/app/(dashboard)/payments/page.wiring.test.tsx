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
vi.mock("@/services/payments", () => ({
  listPendingPayments: vi.fn(async () => ({ data: [], error: null })),
  listPaymentDiscrepancies: vi.fn(async () => ({ data: [], error: null })),
}));
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

async function render(): Promise<ReactElement<Record<string, unknown>>> {
  const boundary = PaymentsPage() as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return (await (child.type as (p: unknown) => Promise<ReactElement>)(child.props)) as ReactElement<
    Record<string, unknown>
  >;
}

describe("payments page wiring (Story 19.9b)", () => {
  beforeEach(() => getGymSettings.mockReset());

  it("passes chargeGuestsPerSession from gym settings, false when the read fails", async () => {
    getGymSettings.mockResolvedValue({ data: { chargeGuestsPerSession: true }, error: null });
    expect((await render()).props.chargeGuestsPerSession).toBe(true);

    getGymSettings.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    expect((await render()).props.chargeGuestsPerSession).toBe(false);
  });
});
