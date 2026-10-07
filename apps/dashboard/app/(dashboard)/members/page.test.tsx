/**
 * Story 18.5: the members page's server-side composition. The page reads the
 * registration fee and hands it to `MembersPageClient`, which hands it to
 * `MemberModal` to pick the one-step or two-step create form. Every other test
 * injects the prop itself, so without this file dropping the `getGymSettings()`
 * read or the `registrationFee` prop would leave the suite green while a fee
 * gym got the one-step form that `createMember` refuses.
 *
 * Asserted on the element tree `MembersData` returns, using
 * page.overview.test.tsx's technique: reach through the page's <Suspense> to
 * the async child and await it; no renderer needed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const listMembers = vi.fn();
vi.mock("@/services/members", () => ({
  listMembers: (...args: unknown[]) => listMembers(...args),
  MEMBERS_PAGE_SIZE: 25,
}));

const listPlans = vi.fn();
vi.mock("@/services/plans", () => ({
  listPlans: (...args: unknown[]) => listPlans(...args),
}));

const listCoaches = vi.fn();
vi.mock("@/services/coaches", () => ({
  listCoaches: (...args: unknown[]) => listCoaches(...args),
}));

const getGymSettings = vi.fn();
vi.mock("@/services/gym-settings", () => ({
  getGymSettings: (...args: unknown[]) => getGymSettings(...args),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...args: unknown[]) => getDashboardShellContext(...args),
}));

const canOfferMobileMoneyPayment = vi.fn();
vi.mock("@/lib/featureFlags", () => ({
  canOfferMobileMoneyPayment: (...args: unknown[]) => canOfferMobileMoneyPayment(...args),
}));

vi.mock("./components/MembersPageClient", () => ({
  MembersPageClient: function MembersPageClient() {
    return null;
  },
}));

vi.mock("./loading", () => ({
  default: function MembersLoading() {
    return null;
  },
}));

import MembersPage from "./page";
import { MembersPageClient } from "./components/MembersPageClient";

async function renderMembersData(): Promise<ReactElement<Record<string, unknown>>> {
  const boundary = MembersPage({ searchParams: Promise.resolve({}) }) as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return (await (child.type as (props: unknown) => Promise<ReactElement>)(child.props)) as ReactElement<
    Record<string, unknown>
  >;
}

function settingsWithFee(registrationFee: number) {
  return { data: { registrationFee }, error: null };
}

describe("members page", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listMembers.mockReset().mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
    listPlans.mockReset().mockResolvedValue({ data: [], error: null });
    listCoaches.mockReset().mockResolvedValue({ data: [], error: null });
    getDashboardShellContext.mockReset().mockResolvedValue({
      data: { gymId: "gym-a", gymName: "Gym A", role: "owner" },
      error: null,
    });
    getGymSettings.mockReset().mockResolvedValue(settingsWithFee(0));
    canOfferMobileMoneyPayment.mockReset().mockResolvedValue(false);
  });

  it("passes the gym's registration fee to MembersPageClient when it is above 0", async () => {
    getGymSettings.mockResolvedValue(settingsWithFee(5000));

    const tree = await renderMembersData();

    expect(tree.type).toBe(MembersPageClient);
    expect(tree.props.registrationFee).toBe(5000);
  });

  it("passes 0 when the gym has no registration fee", async () => {
    const tree = await renderMembersData();

    expect(tree.type).toBe(MembersPageClient);
    expect(tree.props.registrationFee).toBe(0);
  });

  it("falls back to 0 and still renders the list when the settings read fails", async () => {
    getGymSettings.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });

    const tree = await renderMembersData();

    expect(tree.type).toBe(MembersPageClient);
    expect(tree.props.registrationFee).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("passes mobileMoneyEnabled true when Tara Money can be offered (Story 18.6)", async () => {
    canOfferMobileMoneyPayment.mockResolvedValue(true);

    const tree = await renderMembersData();

    expect(tree.props.mobileMoneyEnabled).toBe(true);
  });

  it("passes mobileMoneyEnabled false when Tara Money cannot be offered", async () => {
    const tree = await renderMembersData();

    expect(tree.props.mobileMoneyEnabled).toBe(false);
  });

  it("treats a failed mobile money availability read as false and still renders the list", async () => {
    canOfferMobileMoneyPayment.mockRejectedValue(new Error("boom"));

    const tree = await renderMembersData();

    expect(tree.type).toBe(MembersPageClient);
    expect(tree.props.mobileMoneyEnabled).toBe(false);
  });
});
