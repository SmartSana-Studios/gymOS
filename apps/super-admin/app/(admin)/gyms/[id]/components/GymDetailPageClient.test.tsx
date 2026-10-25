import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Gym detail: the gym card stays on top; audit trail, support and the data tables are tabs, the
// two tables sit together in one tab, and the selected tab lives in the URL.
const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
  usePathname: () => "/gyms/g1",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("../../actions", () => ({ deactivateGym: vi.fn(), reinstateGym: vi.fn(), suspendGym: vi.fn() }));
vi.mock("../../components/GymLifecycleDialog", () => ({ GymLifecycleDialog: () => null }));
vi.mock("./ChangeTierDialog", () => ({ ChangeTierDialog: () => null }));
vi.mock("./CapOverrideEditor", () => ({ CapOverrideEditor: () => null }));
vi.mock("./GymCategoryEditor", () => ({ GymCategoryEditor: () => null }));
vi.mock("./EscalateAccessDialog", () => ({ EscalateAccessDialog: () => null }));
vi.mock("./ActiveAccessList", () => ({ ActiveAccessList: () => <div>ACCESS-LIST</div> }));
vi.mock("./AuditTrailTab", () => ({ AuditTrailTab: () => <div>AUDIT-PANEL</div> }));
vi.mock("../../../support/components/GymSupportPanel", () => ({ GymSupportPanel: () => <div>SUPPORT-PANEL</div> }));
vi.mock("./GymMembersTable", () => ({ GymMembersTable: ({ members }: { members: unknown }) => (members ? <div>MEMBERS-TABLE</div> : null) }));
vi.mock("./GymPaymentsTable", () => ({ GymPaymentsTable: ({ payments }: { payments: unknown }) => (payments ? <div>PAYMENTS-TABLE</div> : null) }));

import { GymDetailPageClient } from "./GymDetailPageClient";
import { renderWithI18n } from "../../../support/components/support-test-utils";

const GYM = { id: "g1", name: "Gym A", status: "active", tierName: "Starter", tierId: "t1", tierMemberCap: 50, memberCap: 50, memberCapOverride: null, memberCount: 3, ownerName: "Pat", ownerPhone: "+237670000000", category: "gym" };

function renderPage(over: Record<string, unknown> = {}) {
  const props = {
    gym: GYM, tiers: [], auditTrail: [], expiresAt: null, activeEscalations: [], currentActorId: null,
    members: null, payments: null, supportAssignments: [], supportAccounts: [], ...over,
  };
  renderWithI18n(<GymDetailPageClient {...(props as unknown as React.ComponentProps<typeof GymDetailPageClient>)} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
});

describe("GymDetailPageClient tabs", () => {
  it("opens on the audit trail and hides the other panels", () => {
    renderPage();
    expect(screen.getByText("AUDIT-PANEL")).toBeInTheDocument();
    expect(screen.queryByText("SUPPORT-PANEL")).toBeNull();
    expect(screen.getByText("ACCESS-LIST")).toBeInTheDocument();
  });

  it("opens on the tab named in the URL and keeps both tables together there", () => {
    search = "tab=data&mpage=2";
    renderPage({ members: {}, payments: {} });
    expect(screen.getByText("MEMBERS-TABLE")).toBeInTheDocument();
    expect(screen.getByText("PAYMENTS-TABLE")).toBeInTheDocument();
    expect(screen.queryByText("AUDIT-PANEL")).toBeNull();
  });

  it("says the data is locked until the gym's data is accessed", () => {
    search = "tab=data";
    renderPage();
    expect(screen.getByText(/only visible after you access/i)).toBeInTheDocument();
  });

  it("writes the selected tab to the URL and keeps the other parameters", async () => {
    search = "ppage=3";
    renderPage();
    await userEvent.setup().click(screen.getByRole("tab", { name: "GymOS support" }));
    expect(replace).toHaveBeenCalledWith("/gyms/g1?ppage=3&tab=support", { scroll: false });
    expect(screen.getByText("SUPPORT-PANEL")).toBeInTheDocument();
  });
});
