/**
 * Story 23.3: the staff page hands `getAllowGymosSupport()` to `StaffPageClient`
 * as `showGymosSupportRow`; a failed read hides the row, never the staff list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const listStaff = vi.fn();
vi.mock("@/services/staff", () => ({ listStaff: (...a: unknown[]) => listStaff(...a) }));
const getAllowGymosSupport = vi.fn();
vi.mock("@/services/gym-settings", () => ({
  getAllowGymosSupport: (...a: unknown[]) => getAllowGymosSupport(...a),
}));
const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...a: unknown[]) => getDashboardShellContext(...a),
}));
vi.mock("./components/StaffPageClient", () => ({
  StaffPageClient: function StaffPageClient() {
    return null;
  },
}));

import StaffPage from "./page";
import { StaffPageClient } from "./components/StaffPageClient";

async function renderedClient(): Promise<ReactElement<Record<string, unknown>>> {
  const suspense = StaffPage() as ReactElement<{ children: ReactElement<unknown, () => Promise<ReactElement>> }>;
  const staffData = suspense.props.children;
  const out = await staffData.type();
  expect(out.type).toBe(StaffPageClient);
  return out as ReactElement<Record<string, unknown>>;
}

describe("StaffPage GymOS Support row wiring", () => {
  beforeEach(() => {
    listStaff.mockReset().mockResolvedValue({ data: [{ id: "m1" }], error: null });
    getDashboardShellContext.mockReset().mockResolvedValue({ data: { role: "manager", memberId: "m1" }, error: null });
    getAllowGymosSupport.mockReset();
  });

  it("passes showGymosSupportRow true when the switch is on", async () => {
    getAllowGymosSupport.mockResolvedValue(true);
    const el = await renderedClient();
    expect(el.props.showGymosSupportRow).toBe(true);
  });

  it("passes false when the switch is off", async () => {
    getAllowGymosSupport.mockResolvedValue(false);
    const el = await renderedClient();
    expect(el.props.showGymosSupportRow).toBe(false);
  });

  it("a rejected read yields false and the staff list still renders", async () => {
    getAllowGymosSupport.mockRejectedValue(new Error("boom"));
    const el = await renderedClient();
    expect(el.props.showGymosSupportRow).toBe(false);
    expect(el.props.initialStaff).toEqual([{ id: "m1" }]);
  });
});
