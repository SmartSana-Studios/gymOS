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
const getGymosSupportStatus = vi.fn();
vi.mock("@/services/gym-settings", () => ({
  getGymSettings: (...a: unknown[]) => getGymSettings(...a),
  getGymosSupportStatus: (...a: unknown[]) => getGymosSupportStatus(...a),
}));
vi.mock("@/services/gym-payment-credentials", () => ({
  getGymPaymentConnectionStatus: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/services/billing", () => ({
  getGymBillingInfo: vi.fn(async () => ({ data: null, error: null })),
  listSelectableTiers: vi.fn(async () => ({ data: [], error: null })),
}));
const listPlans = vi.fn();
vi.mock("@/services/plans", () => ({
  listPlans: (...a: unknown[]) => listPlans(...a),
}));
vi.mock("@/services/staff", () => ({
  listStaff: vi.fn(async () => ({ data: [], error: null })),
}));
const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...a: unknown[]) => getDashboardShellContext(...a),
}));
const getLandingPageState = vi.fn();
vi.mock("@/services/landing-page", () => ({ getLandingPageState: (...a: unknown[]) => getLandingPageState(...a) }));
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
    getGymosSupportStatus.mockReset().mockResolvedValue({ data: { allowed: true, state: "none", lastActedAt: null }, error: null });
    getDashboardShellContext.mockReset();
    listPlans.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("passes the shell role to SettingsForm", async () => {
    getDashboardShellContext.mockResolvedValue({ data: { role: "owner" }, error: null, suspended: null });
    expect((await renderedForm()).props.role).toBe("owner");
  });

  it("passes the Owner-only GymOS Support status, and nothing for another role", async () => {
    getDashboardShellContext.mockResolvedValue({ data: { role: "owner" }, error: null, suspended: null });
    expect((await renderedForm()).props.gymosSupportStatus).toEqual({ allowed: true, state: "none", lastActedAt: null });
    getDashboardShellContext.mockResolvedValue({ data: { role: "supervisor" }, error: null, suspended: null });
    expect((await renderedForm()).props.gymosSupportStatus).toBeNull();
  });

  it.each([
    ["errors", { data: null, error: { code: "unknown", message: "x" }, suspended: null }],
    ["returns null", { data: null, error: null, suspended: null }],
  ])("passes role=null when the shell lookup %s", async (_label, result) => {
    getDashboardShellContext.mockResolvedValue(result);
    expect((await renderedForm()).props.role).toBeNull();
  });
});

describe("SettingsPage landing page row (24.9)", () => {
  beforeEach(() => {
    getGymSettings.mockReset().mockResolvedValue({ data: { chargeGuestsPerSession: false }, error: null });
    getGymosSupportStatus.mockReset().mockResolvedValue({ data: null, error: null });
    listPlans.mockReset().mockResolvedValue({ data: [], error: null });
    getLandingPageState.mockReset().mockResolvedValue("in_progress");
    getDashboardShellContext.mockReset();
  });

  it.each(["owner", "supervisor", "support"])("%s gets the page state from the service", async (role) => {
    getDashboardShellContext.mockResolvedValue({ data: { role, gymId: "g1", memberId: "m1" }, error: null, suspended: null });
    const props = (await renderedForm()).props;
    expect(getLandingPageState).toHaveBeenCalledTimes(1);
    expect(props.landingPageState).toBe("in_progress");
    expect(props.landingPageUserKey).toBe("g1:m1");
  });

  it.each(["manager", "receptionist", "coach"])("%s: the service is not called and the state is null", async (role) => {
    getDashboardShellContext.mockResolvedValue({ data: { role, gymId: "g1", memberId: "m1" }, error: null, suspended: null });
    expect((await renderedForm()).props.landingPageState).toBeNull();
    expect(getLandingPageState).not.toHaveBeenCalled();
  });

  it("an unreadable state is passed as null, not an error", async () => {
    getLandingPageState.mockResolvedValue(null);
    getDashboardShellContext.mockResolvedValue({ data: { role: "owner", gymId: "g1", memberId: null }, error: null, suspended: null });
    const props = (await renderedForm()).props;
    expect(props.landingPageState).toBeNull();
    expect(props.landingPageUserKey).toBe("g1:owner");
  });
});

describe("SettingsPage loyaltyPlans", () => {
  beforeEach(() => {
    getGymosSupportStatus.mockReset().mockResolvedValue({ data: null, error: null });
    getGymSettings.mockReset().mockResolvedValue({ data: { chargeGuestsPerSession: false }, error: null });
    getDashboardShellContext.mockReset().mockResolvedValue({ data: { role: "owner" }, error: null, suspended: null });
  });

  it("passes only subscription plans that have a duration", async () => {
    listPlans.mockReset().mockResolvedValue({
      data: [
        { id: "1", name: "Drop-in", planType: "pay_per_session", durationDays: null },
        { id: "2", name: "Odd", planType: "monthly", durationDays: null },
        { id: "3", name: "Monthly", planType: "monthly", durationDays: 30 },
        { id: "4", name: "Annual", planType: "class_only", durationDays: 365 },
      ],
      error: null,
    });
    expect((await renderedForm()).props.loyaltyPlans).toEqual([
      { name: "Monthly", durationDays: 30 },
      { name: "Annual", durationDays: 365 },
    ]);
  });

  it("passes an empty list when the plans read fails", async () => {
    listPlans.mockReset().mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    expect((await renderedForm()).props.loyaltyPlans).toEqual([]);
  });
});
