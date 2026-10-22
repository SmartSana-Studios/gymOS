import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createSupportAccount = vi.fn();
const sendSupportInvite = vi.fn();
const deactivateSupportAccount = vi.fn();
const removeSupportAccount = vi.fn();
const assignSupport = vi.fn();
const runDueFactorResets = vi.fn();
vi.mock("../actions", () => ({
  createSupportAccount: (...a: unknown[]) => createSupportAccount(...a),
  sendSupportInvite: (...a: unknown[]) => sendSupportInvite(...a),
  deactivateSupportAccount: (...a: unknown[]) => deactivateSupportAccount(...a),
  removeSupportAccount: (...a: unknown[]) => removeSupportAccount(...a),
  assignSupport: (...a: unknown[]) => assignSupport(...a),
  runDueFactorResets: (...a: unknown[]) => runDueFactorResets(...a),
  confirmSupportAssignment: vi.fn(),
  unassignSupport: vi.fn(),
  unlockSupportAccount: vi.fn(),
  recertifySupportAccount: vi.fn(),
  startSupportFactorReset: vi.fn(),
  changeSupportContact: vi.fn(),
  answerDisclosureRequest: vi.fn(),
}));
vi.mock("@/components/step-up-prompt", () => ({ StepUpPrompt: () => null }));
const refresh = vi.fn();
const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
  usePathname: () => "/support",
  useSearchParams: () => new URLSearchParams(search),
}));

import { SupportPageClient } from "./SupportPageClient";
import { menuItems, modal, pickRowAction, renderWithI18n } from "./support-test-utils";
import type { SupportAccountRow, SupportLifecycleRow } from "../actions";

const LOCK = { userId: "u1", displayName: "Pat Locked", email: "pat@gymosapps.com", lockedAt: "2026-10-21T10:00:00Z", lockedReason: "velocity_gym", gymNames: "Gym A" };
const ACCOUNT = (over: Partial<SupportAccountRow> = {}): SupportAccountRow => ({ userId: "u9", displayName: "Reset Person", email: "r@gymosapps.com", assignable: true, activated: true, activatedAt: "2026-10-01T10:00:00Z", inviteState: "used", inviteExpiresAt: null, ...over });
const life = (resetState: string | null): SupportLifecycleRow => ({
  userId: "u9", displayName: "Reset Person", email: "r@gymosapps.com", activated: true, deactivated: false, lockedAt: null, lockedReason: null,
  recertifyDueAt: null, recertificationLapsed: false, resetPendingAt: resetState ? "2026-10-21T10:00:00Z" : null, resetState, resetExecutesAt: null, lastActiveAt: null,
});
const WHY = "Why are you doing this?";

function renderPage(props: Partial<React.ComponentProps<typeof SupportPageClient>> = {}) {
  renderWithI18n(<SupportPageClient initialAccounts={[]} assignments={[]} gyms={[{ id: "g1", name: "Gym A" }]} disclosures={[]} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
});

describe("SupportPageClient layout", () => {
  it("badges the Locked and Disclosure tabs with their counts, and shows a load error in the tab instead of the empty state", () => {
    search = "tab=locks";
    renderPage({
      locks: [LOCK],
      disclosures: [{ id: "d1", gymId: "g1", gymName: "Gym A", auditLogId: "a1", auditActionType: "x", auditCreatedAt: "2026-10-01T10:00:00Z", question: "Q?", requestedAt: "2026-10-01T10:00:00Z", answerDueAt: "2026-10-05T10:00:00Z", overdue: true, answeredAt: null, answer: null }],
    });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toContain("Locked accounts1");
    expect(tabs).toContain("Disclosure requests1");
  });

  it("a failed locks load shows the error in the Locked tab, not No locked accounts", () => {
    search = "tab=locks";
    renderPage({ loadErrors: { locks: "Could not load locks" } });
    expect(screen.getByRole("alert").textContent).toBe("Could not load locks");
    expect(screen.queryByText("No locked accounts.")).toBeNull();
  });

  it("shows the three top buttons and five tabs in order, Accounts selected, and no inline form or page-wide reason box", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign to gym" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run due resets" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Accounts", "Assignments", "Locked accounts", "Lifecycle", "Disclosure requests"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByPlaceholderText(WHY)).toBeNull();
    expect(screen.queryByPlaceholderText("name@gymosapps.com")).toBeNull();
    expect(screen.getByText("No support accounts yet.")).toBeTruthy();
  });

  it("opens the tab named in ?tab= and falls back to Accounts for an unknown value", () => {
    search = "tab=locks";
    renderPage({ locks: [LOCK] });
    expect(screen.getByRole("tab", { name: /^Locked accounts/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Pat Locked")).toBeTruthy();
  });

  it("falls back to Accounts for an unknown ?tab=", () => {
    search = "tab=nonsense";
    renderPage();
    expect(screen.getByRole("tab", { name: "Accounts" }).getAttribute("aria-selected")).toBe("true");
  });

  it("choosing a tab shows it and writes ?tab= to the URL", async () => {
    const user = userEvent.setup();
    renderPage({ locks: [LOCK] });
    await user.click(screen.getByRole("tab", { name: /^Locked accounts/ }));
    expect(replace).toHaveBeenCalledWith("/support?tab=locks", { scroll: false });
    expect(screen.getByText("Pat Locked")).toBeTruthy();
  });

  it.each([
    ["assignments", "No open assignments."],
    ["locks", "No locked accounts."],
    ["lifecycle", "No activated support person."],
    ["disclosure", "No disclosure requests."],
  ])("the %s tab shows its empty state", (tab, text) => {
    search = `tab=${tab}`;
    renderPage();
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("paginates the accounts table per tab", async () => {
    const user = userEvent.setup();
    renderPage({ initialAccounts: Array.from({ length: 12 }, (_, i) => ACCOUNT({ userId: `u${i}`, displayName: `P${i}`, activated: false, inviteState: "none" })) });
    expect(screen.getAllByRole("row")).toHaveLength(11);
    await user.selectOptions(screen.getAllByLabelText("Rows per page")[0], "25");
    expect(screen.getAllByRole("row")).toHaveLength(13);
  });
});

describe("top buttons and modals", () => {
  it("Create account modal creates the account, closes and reports success", async () => {
    createSupportAccount.mockResolvedValue({ data: { userId: "n1" }, error: null });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const m = await modal();
    await user.type(m.getByLabelText("Name"), "New Person");
    await user.type(m.getByLabelText("GymOS email"), "new@gymosapps.com");
    await user.click(m.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(createSupportAccount).toHaveBeenCalledWith({ displayName: "New Person", email: "new@gymosapps.com" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Support account created. Send the invite when ready.")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("Create account shows the domain refusal inline and stays open", async () => {
    createSupportAccount.mockResolvedValue({ data: null, error: { code: "domain", message: "Use an @gymosapps.com address." } });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const m = await modal();
    await user.type(m.getByLabelText("Name"), "X");
    await user.type(m.getByLabelText("GymOS email"), "x@example.com");
    await user.click(m.getByRole("button", { name: "Create account" }));
    expect(await m.findByText("Use an @gymosapps.com address.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Assign to gym modal needs person, gym and a 3 character reason, then assigns", async () => {
    assignSupport.mockResolvedValue({ data: { code: "pending", assignmentId: "a1" }, error: null });
    const user = userEvent.setup();
    renderPage({ initialAccounts: [ACCOUNT()] });
    await user.click(screen.getByRole("button", { name: "Assign to gym" }));
    const m = await modal();
    const submit = m.getByRole("button", { name: "Assign" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const [person, gym] = m.getAllByRole("combobox");
    await user.selectOptions(person, "u9");
    await user.selectOptions(gym, "g1");
    expect(submit.disabled).toBe(true);
    await user.type(m.getByPlaceholderText(WHY), "cover the launch");
    await user.click(submit);
    await waitFor(() => expect(assignSupport).toHaveBeenCalledWith({ userId: "u9", gymId: "g1", reason: "cover the launch" }));
    expect(await screen.findByText("Assigned; waiting for confirmation.")).toBeTruthy();
  });

  it("Assign to gym modal offers only assignable, non-deactivated people, and marks the not-yet-activated", async () => {
    const user = userEvent.setup();
    renderPage({
      initialAccounts: [
        ACCOUNT({ userId: "ok", displayName: "Ready" }),
        ACCOUNT({ userId: "new", displayName: "Newcomer", activated: false, inviteState: "none" }),
        ACCOUNT({ userId: "no", displayName: "Not assignable", assignable: false }),
        ACCOUNT({ userId: "gone", displayName: "Gone", inviteState: "deactivated" }),
      ],
    });
    await user.click(screen.getByRole("button", { name: "Assign to gym" }));
    const [person] = (await modal()).getAllByRole("combobox");
    const options = Array.from((person as HTMLSelectElement).options).map((o) => [o.value, o.textContent]);
    expect(options).toEqual([["", "Choose…"], ["ok", "Ready"], ["new", "Newcomer (Not activated)"]]);
  });

  it("the Disclosure requests tab shows the requests the page passes in", () => {
    search = "tab=disclosure";
    renderPage({
      disclosures: [
        { id: "r1", gymId: "g1", gymName: "Gym A", auditLogId: "a1", auditActionType: "refund_recorded", auditCreatedAt: "2026-10-20T10:00:00Z", question: "Who made this change?", requestedAt: "2026-10-21T10:00:00Z", answerDueAt: "2026-10-26T10:00:00Z", overdue: false, answeredAt: null, answer: null },
      ],
    });
    expect(screen.getByText("Who made this change?")).toBeTruthy();
  });

  it("Run due resets shows the result", async () => {
    runDueFactorResets.mockResolvedValue({ data: { claimed: 3, done: 2, failed: 1 }, error: null });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Run due resets" }));
    expect(await screen.findByText("2 reset(s) executed, 1 failed.")).toBeTruthy();
  });
});

describe("accounts table row actions", () => {
  it("shows only the actions valid for each row", async () => {
    const user = userEvent.setup();
    renderPage({
      initialAccounts: [
        ACCOUNT({ userId: "a", displayName: "Fresh", activated: false, inviteState: "none" }),
        ACCOUNT({ userId: "b", displayName: "Live", activated: true, inviteState: "used" }),
        ACCOUNT({ userId: "c", displayName: "Gone", activated: false, inviteState: "deactivated", assignable: false }),
      ],
    });
    expect(await menuItems(user, "Fresh")).toEqual(["Send invite", "Deactivate", "Remove"]);
    expect(await menuItems(user, "Live")).toEqual(["Deactivate"]);
    // A deactivated account can no longer be invited or deactivated, but (as before) a never-activated one can still be removed.
    expect(await menuItems(user, "Gone")).toEqual(["Remove"]);
  });

  it("Send invite runs without a reason", async () => {
    sendSupportInvite.mockResolvedValue({ data: { sent: true }, error: null });
    const user = userEvent.setup();
    renderPage({ initialAccounts: [ACCOUNT({ userId: "a", displayName: "Fresh", activated: false, inviteState: "none" })] });
    await pickRowAction(user, "Fresh", "Send invite");
    await waitFor(() => expect(sendSupportInvite).toHaveBeenCalledWith("a"));
    expect(await screen.findByText("Invite emailed.")).toBeTruthy();
  });

  it("Deactivate asks for a reason with the confirm wording, then calls the action", async () => {
    deactivateSupportAccount.mockResolvedValue({ data: { code: "deactivated", assignmentId: null }, error: null });
    const user = userEvent.setup();
    renderPage({ initialAccounts: [ACCOUNT()] });
    await pickRowAction(user, "Reset Person", "Deactivate");
    const m = await modal();
    expect(m.getByText(/Deactivate this account\? It ends every assignment/)).toBeTruthy();
    await user.type(m.getByPlaceholderText(WHY), "left the company");
    await user.click(m.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(deactivateSupportAccount).toHaveBeenCalledWith({ userId: "u9", reason: "left the company" }));
    expect(await screen.findByText("Account deactivated.")).toBeTruthy();
  });

  it("Remove calls removeSupportAccount with the reason", async () => {
    removeSupportAccount.mockResolvedValue({ data: { code: "removed", assignmentId: null }, error: null });
    const user = userEvent.setup();
    renderPage({ initialAccounts: [ACCOUNT({ activated: false, inviteState: "none" })] });
    await pickRowAction(user, "Reset Person", "Remove");
    const m = await modal();
    await user.type(m.getByPlaceholderText(WHY), "typo in the name");
    await user.click(m.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeSupportAccount).toHaveBeenCalledWith({ userId: "u9", reason: "typo in the name" }));
  });

  it("a reason typed for one action never carries to the next modal", async () => {
    const user = userEvent.setup();
    renderPage({ initialAccounts: [ACCOUNT()] });
    await pickRowAction(user, "Reset Person", "Deactivate");
    await user.type((await modal()).getByPlaceholderText(WHY), "first reason");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await pickRowAction(user, "Reset Person", "Deactivate");
    expect(((await modal()).getByPlaceholderText(WHY) as HTMLInputElement).value).toBe("");
  });
});

describe("re-invite after a factor reset (Story 23.11)", () => {
  it("an activated account offers the invite only once its reset has been executed", async () => {
    const user = userEvent.setup();
    renderPage({ initialAccounts: [ACCOUNT()], lifecycle: [life("executed")] });
    expect(await menuItems(user, "Reset Person")).toEqual(["Send a new invite", "Deactivate"]);
  });

  it.each([["cooling_off"], [null]] as const)("no invite for an activated account with reset state %s", async (state) => {
    const user = userEvent.setup();
    renderPage({ initialAccounts: [ACCOUNT()], lifecycle: [life(state)] });
    expect(await menuItems(user, "Reset Person")).toEqual(["Deactivate"]);
  });
});
