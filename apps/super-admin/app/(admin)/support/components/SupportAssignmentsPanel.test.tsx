import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const confirmSupportAssignment = vi.fn();
const unassignSupport = vi.fn();
const assignSupport = vi.fn();
vi.mock("../actions", () => ({
  confirmSupportAssignment: (...a: unknown[]) => confirmSupportAssignment(...a),
  unassignSupport: (...a: unknown[]) => unassignSupport(...a),
  assignSupport: (...a: unknown[]) => assignSupport(...a),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { GymSupportPanel } from "./GymSupportPanel";
import { SupportAssignmentsPanel } from "./SupportAssignmentsPanel";
import { menuItems, modal, pickRowAction, renderWithI18n } from "./support-test-utils";
import type { SupportAccountRow, SupportAssignmentRow } from "../actions";

const A = (over: Partial<SupportAssignmentRow> = {}): SupportAssignmentRow =>
  ({ assignmentId: "a1", userId: "u1", displayName: "Pat", email: "pat@gymosapps.com", gymId: "g1", gymName: "Gym A", state: "active", suspendedBySwitch: false, createdAt: "2026-10-01T10:00:00Z", endedAt: null, ...over }) as SupportAssignmentRow;
const ACCOUNT: SupportAccountRow = { userId: "u1", displayName: "Pat", email: "pat@gymosapps.com", assignable: true, activated: true, activatedAt: "2026-10-01T10:00:00Z", inviteState: "used", inviteExpiresAt: null };
const WHY = "Why are you doing this?";

beforeEach(() => {
  [confirmSupportAssignment, unassignSupport, assignSupport, refresh].forEach((m) => m.mockReset());
});

describe("SupportAssignmentsPanel", () => {
  it("shows the empty state", () => {
    renderWithI18n(<SupportAssignmentsPanel assignments={[]} onMessage={vi.fn()} />);
    expect(screen.getByText("No open assignments.")).toBeTruthy();
  });

  it("an active row offers only Unassign; a pending row offers Confirm and Unassign", async () => {
    const user = userEvent.setup();
    renderWithI18n(<SupportAssignmentsPanel assignments={[A(), A({ assignmentId: "a2", displayName: "Sam", state: "pending" })]} onMessage={vi.fn()} />);
    expect(await menuItems(user, "Pat")).toEqual(["Unassign"]);
    expect(await menuItems(user, "Sam")).toEqual(["Confirm", "Unassign"]);
  });

  it("Unassign asks for a reason (disabled until 3 characters) and calls the action with it", async () => {
    unassignSupport.mockResolvedValue({ data: { code: "ended", assignmentId: "a1" }, error: null });
    const user = userEvent.setup();
    const onMessage = vi.fn();
    renderWithI18n(<SupportAssignmentsPanel assignments={[A()]} onMessage={onMessage} />);
    await pickRowAction(user, "Pat", "Unassign");
    const m = await modal();
    const submit = m.getByRole("button", { name: "Unassign" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(m.getByPlaceholderText(WHY), "no");
    expect(submit.disabled).toBe(true);
    await user.type(m.getByPlaceholderText(WHY), "pe");
    await user.click(submit);
    await waitFor(() => expect(unassignSupport).toHaveBeenCalledWith({ assignmentId: "a1", reason: "nope" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith({ kind: "ok", text: "Assignment ended." }));
    expect(refresh).toHaveBeenCalled();
  });

  it("Confirm calls the confirm action; a refusal stays in the modal", async () => {
    confirmSupportAssignment.mockResolvedValue({ data: null, error: { code: "switch_off", message: "The Owner has GymOS support turned off for this gym, so it cannot be confirmed." } });
    const user = userEvent.setup();
    renderWithI18n(<SupportAssignmentsPanel assignments={[A({ state: "pending" })]} onMessage={vi.fn()} />);
    await pickRowAction(user, "Pat", "Confirm");
    const m = await modal();
    await user.type(m.getByPlaceholderText(WHY), "go live");
    await user.click(m.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(confirmSupportAssignment).toHaveBeenCalledWith({ assignmentId: "a1", reason: "go live" }));
    expect(await m.findByText(/turned off for this gym/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("drops the Gym column when the panel is pinned to one gym, and keeps header and cells aligned", () => {
    renderWithI18n(<SupportAssignmentsPanel assignments={[A()]} fixedGymId="g1" onMessage={vi.fn()} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("Gym");
    expect(screen.getAllByRole("row")[1].querySelectorAll("td").length).toBe(headers.length);
    expect(screen.queryByText("Gym A")).toBeNull();
  });

  it("paginates and keeps ended assignments in a summary", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 12 }, (_, i) => A({ assignmentId: `a${i}`, displayName: `P${i}` }));
    renderWithI18n(<SupportAssignmentsPanel assignments={[...rows, A({ assignmentId: "e", state: "ended", endedAt: "2026-10-02T10:00:00Z" })]} onMessage={vi.fn()} />);
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("1 ended assignment(s)")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: /next/i })[0]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

describe("GymSupportPanel", () => {
  it("assign button opens the modal with the gym fixed (no gym field) and assigns to that gym", async () => {
    assignSupport.mockResolvedValue({ data: { code: "active", assignmentId: "a9" }, error: null });
    const user = userEvent.setup();
    renderWithI18n(<GymSupportPanel gymId="g1" assignments={[]} accounts={[ACCOUNT]} />);
    await user.click(screen.getByRole("button", { name: "Assign to gym" }));
    const m = await modal();
    expect(m.queryByText("Gym")).toBeNull();
    const submit = m.getByRole("button", { name: "Assign" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.selectOptions(m.getByRole("combobox"), "u1");
    await user.type(m.getByPlaceholderText(WHY), "new on-site help");
    await user.click(submit);
    await waitFor(() => expect(assignSupport).toHaveBeenCalledWith({ userId: "u1", gymId: "g1", reason: "new on-site help" }));
    await waitFor(() => expect(screen.getByText("Assigned and active.")).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
