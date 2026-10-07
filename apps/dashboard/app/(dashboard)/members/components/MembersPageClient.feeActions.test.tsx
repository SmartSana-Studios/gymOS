/**
 * Story 18.6: the registration-fee row actions on the members list and the role
 * matrix. Collect is for all four staff roles; Waive and Assign plan for manager,
 * supervisor and owner; Void for supervisor and owner. A fee-0 gym shows none of
 * them, and each opens its dialog with the right member and props.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();

vi.mock("../actions", () => ({
  sendMemberInvite: vi.fn(),
  exportMembersCsv: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => "/members",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("./MemberModal", () => ({ MemberModal: () => null }));
vi.mock("./DeactivateMemberDialog", () => ({ DeactivateMemberDialog: () => null }));
vi.mock("./CsvImportModal", () => ({ CsvImportModal: () => null }));
vi.mock("./InviteMemberModal", () => ({ InviteMemberModal: () => null }));

type DialogProps = Record<string, unknown>;
const collectProps = vi.fn();
vi.mock("./CollectRegistrationFeeDialog", () => ({
  CollectRegistrationFeeDialog: (props: DialogProps) => {
    collectProps(props);
    return (
      <div role="dialog" aria-label="collect-dialog">
        <button data-testid="finish-collect" onClick={() => (props.onCollected as () => void)()} />
      </div>
    );
  },
}));
vi.mock("./WaiveRegistrationFeeDialog", () => ({
  WaiveRegistrationFeeDialog: (props: DialogProps) => (
    <div role="dialog" aria-label="waive-dialog">
      <button data-testid="finish-waive" onClick={() => (props.onDone as () => void)()} />
    </div>
  ),
}));
vi.mock("./VoidRegistrationFeeDialog", () => ({
  VoidRegistrationFeeDialog: (props: DialogProps) => (
    <div role="dialog" aria-label="void-dialog">
      <button data-testid="finish-void" onClick={() => (props.onDone as () => void)()} />
    </div>
  ),
}));
vi.mock("./AssignInitialPlanDialog", () => ({
  AssignInitialPlanDialog: (props: DialogProps) => (
    <div role="dialog" aria-label="assign-dialog">
      <button data-testid="finish-assign" onClick={() => (props.onDone as (w?: string) => void)()} />
      <button data-testid="finish-assign-warning" onClick={() => (props.onDone as (w?: string) => void)("Audit write failed.")} />
    </div>
  ),
}));

const base = {
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  planId: null,
  planName: null,
  planType: null,
  status: "no_active_plan" as const,
  expiryDate: null,
  joinDate: "2026-01-01",
  deactivatedAt: null,
};

const awaiting = { ...base, id: "m-awaiting", name: "Awaiting Ann", registrationFeeSettledAt: null };
const settledNoPlan = { ...base, id: "m-settled", name: "Settled Sam", registrationFeeSettledAt: "2026-01-02T00:00:00Z" };
const withPlan = {
  ...base,
  id: "m-plan",
  name: "Planned Pat",
  planId: "plan-1",
  planName: "Monthly",
  status: "active" as const,
  registrationFeeSettledAt: "2026-01-02T00:00:00Z",
};
const deactivatedAwaiting = { ...awaiting, id: "m-deact", name: "Gone Gus", deactivatedAt: "2026-02-01T00:00:00Z" };

type Role = "owner" | "supervisor" | "manager" | "receptionist";

async function renderPage(
  member: typeof awaiting | typeof settledNoPlan | typeof withPlan | typeof deactivatedAwaiting,
  role: Role,
  opts: { registrationFee?: number; mobileMoneyEnabled?: boolean } = {},
) {
  const { MembersPageClient } = await import("./MembersPageClient");
  render(
    <MembersPageClient
      initialMembers={[member as never]}
      total={1}
      page={1}
      pageSize={25}
      search=""
      status=""
      role={role}
      plans={[]}
      coaches={[]}
      gymName="Iron Gym"
      registrationFee={opts.registrationFee ?? 5000}
      mobileMoneyEnabled={opts.mobileMoneyEnabled}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /members.actions.menu/ }));
}

function has(name: string): boolean {
  return screen.queryByRole("menuitem", { name: new RegExp(name) }) !== null;
}

describe("MembersPageClient registration fee actions (Story 18.6)", () => {
  beforeEach(() => {
    collectProps.mockReset();
    refresh.mockReset();
  });

  describe("awaiting member: Collect and Waive", () => {
    it.each([
      ["receptionist", true, false],
      ["manager", true, true],
      ["supervisor", true, true],
      ["owner", true, true],
    ] as [Role, boolean, boolean][])("%s: collect=%s waive=%s, never void or assign", async (role, collect, waive) => {
      await renderPage(awaiting, role);

      expect(has("members.actions.collectFee")).toBe(collect);
      expect(has("members.actions.waiveFee")).toBe(waive);
      expect(has("members.actions.voidFee")).toBe(false);
      expect(has("members.actions.assignPlan")).toBe(false);
    });
  });

  describe("settled member with no plan: Assign plan and Void", () => {
    it.each([
      ["receptionist", false, false],
      ["manager", true, false],
      ["supervisor", true, true],
      ["owner", true, true],
    ] as [Role, boolean, boolean][])("%s: assign=%s void=%s, never collect or waive", async (role, assign, voidFee) => {
      await renderPage(settledNoPlan, role);

      expect(has("members.actions.assignPlan")).toBe(assign);
      expect(has("members.actions.voidFee")).toBe(voidFee);
      expect(has("members.actions.collectFee")).toBe(false);
      expect(has("members.actions.waiveFee")).toBe(false);
    });
  });

  it("a member with a plan gets no fee action at all", async () => {
    await renderPage(withPlan, "owner");

    for (const key of ["collectFee", "waiveFee", "assignPlan", "voidFee"]) {
      expect(has(`members.actions.${key}`)).toBe(false);
    }
  });

  it("a deactivated awaiting member gets no fee action", async () => {
    await renderPage(deactivatedAwaiting, "owner");

    for (const key of ["collectFee", "waiveFee", "assignPlan", "voidFee"]) {
      expect(has(`members.actions.${key}`)).toBe(false);
    }
  });

  it("a fee-0 gym shows none of the new actions for a settled member without a plan", async () => {
    await renderPage(settledNoPlan, "owner", { registrationFee: 0 });

    for (const key of ["collectFee", "waiveFee", "assignPlan", "voidFee"]) {
      expect(has(`members.actions.${key}`)).toBe(false);
    }
  });

  it("opens the collect dialog with the fee, the Tara flag and the member; a finished collect refreshes the list", async () => {
    const user = userEvent.setup();
    await renderPage(awaiting, "receptionist", { mobileMoneyEnabled: true });

    await user.click(screen.getByRole("menuitem", { name: /members.actions.collectFee/ }));

    expect(screen.getByRole("dialog", { name: "collect-dialog" })).toBeInTheDocument();
    expect(collectProps).toHaveBeenCalledWith(
      expect.objectContaining({ registrationFee: 5000, mobileMoneyEnabled: true, member: expect.objectContaining({ id: "m-awaiting" }) }),
    );

    await user.click(screen.getByTestId("finish-collect"));

    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "collect-dialog" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("members.feeCollect.collectedToast");
  });

  it("defaults the Tara flag to false when the page does not pass it", async () => {
    const user = userEvent.setup();
    await renderPage(awaiting, "owner");

    await user.click(screen.getByRole("menuitem", { name: /members.actions.collectFee/ }));

    expect(collectProps).toHaveBeenCalledWith(expect.objectContaining({ mobileMoneyEnabled: false }));
  });

  it("opens the waive dialog; finishing closes it, toasts and refreshes the list", async () => {
    const user = userEvent.setup();
    await renderPage(awaiting, "owner");
    await user.click(screen.getByRole("menuitem", { name: /members.actions.waiveFee/ }));
    expect(screen.getByRole("dialog", { name: "waive-dialog" })).toBeInTheDocument();

    await user.click(screen.getByTestId("finish-waive"));

    expect(screen.queryByRole("dialog", { name: "waive-dialog" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("members.feeWaive.waivedToast");
    expect(refresh).toHaveBeenCalled();
  });

  it("opens the assign dialog for a settled member without a plan", async () => {
    const user = userEvent.setup();
    await renderPage(settledNoPlan, "manager");
    await user.click(screen.getByRole("menuitem", { name: /members.actions.assignPlan/ }));
    expect(screen.getByRole("dialog", { name: "assign-dialog" })).toBeInTheDocument();

    await user.click(screen.getByTestId("finish-assign"));

    expect(screen.queryByRole("dialog", { name: "assign-dialog" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("members.assignPlan.assignedToast");
    expect(refresh).toHaveBeenCalled();
  });

  it("an assign warning replaces the success toast and still refreshes", async () => {
    const user = userEvent.setup();
    await renderPage(settledNoPlan, "manager");
    await user.click(screen.getByRole("menuitem", { name: /members.actions.assignPlan/ }));

    await user.click(screen.getByTestId("finish-assign-warning"));

    expect(screen.getByRole("status")).toHaveTextContent("Audit write failed.");
    expect(screen.getByRole("status")).not.toHaveTextContent("members.assignPlan.assignedToast");
    expect(refresh).toHaveBeenCalled();
  });

  it("opens the void dialog for a settled member without a plan", async () => {
    const user = userEvent.setup();
    await renderPage(settledNoPlan, "supervisor");
    await user.click(screen.getByRole("menuitem", { name: /members.actions.voidFee/ }));
    expect(screen.getByRole("dialog", { name: "void-dialog" })).toBeInTheDocument();

    await user.click(screen.getByTestId("finish-void"));

    expect(screen.queryByRole("dialog", { name: "void-dialog" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("members.feeVoid.voidedToast");
    expect(refresh).toHaveBeenCalled();
  });
});
