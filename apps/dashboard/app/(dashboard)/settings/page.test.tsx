/**
 * Story 19.9a: the settings page hands the caller's shell role to
 * `SettingsForm`, which gates the charge-guests control on it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const getGymSettings = vi.fn();
vi.mock("@/services/gym-settings", () => ({
  getGymSettings: (...a: unknown[]) => getGymSettings(...a),
}));
vi.mock("@/services/gym-payment-credentials", () => ({
  getGymPaymentConnectionStatus: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/services/billing", () => ({
  getGymBillingInfo: vi.fn(async () => ({ data: null, error: null })),
  listSelectableTiers: vi.fn(async () => ({ data: [], error: null })),
}));
vi.mock("@/services/staff", () => ({
  listStaff: vi.fn(async () => ({ data: [], error: null })),
}));
const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...a: unknown[]) => getDashboardShellContext(...a),
}));
vi.mock("@/lib/featureFlags", () => ({ TARAMONEY_PROVIDER_KEY: "taramoney" }));
vi.mock("./SettingsForm", () => ({
  SettingsForm: function SettingsForm() {
    return null;
  },
}));

import SettingsPage from "./page";
import { SettingsForm } from "./SettingsForm";

async function renderedForm(): Promise<ReactElement<Record<string, unknown>>> {
  const root = (await SettingsPage()) as ReactElement<{ children: ReactElement[] }>;
  const form = root.props.children.find((c) => c.type === SettingsForm);
  if (!form) throw new Error("SettingsForm not rendered");
  return form as ReactElement<Record<string, unknown>>;
}

describe("SettingsPage role prop", () => {
  beforeEach(() => {
    getGymSettings.mockReset().mockResolvedValue({ data: { chargeGuestsPerSession: false }, error: null });
    getDashboardShellContext.mockReset();
  });

  it("passes the shell role to SettingsForm", async () => {
    getDashboardShellContext.mockResolvedValue({ data: { role: "owner" }, error: null, suspended: null });
    expect((await renderedForm()).props.role).toBe("owner");
  });

  it.each([
    ["errors", { data: null, error: { code: "unknown", message: "x" }, suspended: null }],
    ["returns null", { data: null, error: null, suspended: null }],
  ])("passes role=null when the shell lookup %s", async (_label, result) => {
    getDashboardShellContext.mockResolvedValue(result);
    expect((await renderedForm()).props.role).toBeNull();
  });
});
