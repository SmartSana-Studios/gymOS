import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const unlockSupportAccount = vi.fn();
vi.mock("../actions", () => ({ unlockSupportAccount: (...a: unknown[]) => unlockSupportAccount(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SupportLocksPanel } from "./SupportLocksPanel";
import { modal, pickRowAction, renderWithI18n } from "./support-test-utils";

const LOCK = { userId: "u1", displayName: "Pat", email: "pat@gymosapps.com", lockedAt: "2026-10-21T10:00:00Z", lockedReason: "velocity_gym", gymNames: "Gym A" };

function renderPanel(locks: (typeof LOCK)[], onMessage = vi.fn()) {
  renderWithI18n(<SupportLocksPanel locks={locks} onMessage={onMessage} />);
  return onMessage;
}

describe("SupportLocksPanel", () => {
  beforeEach(() => {
    unlockSupportAccount.mockReset();
    refresh.mockReset();
  });

  it("says so when nothing is locked", () => {
    renderPanel([]);
    expect(screen.getByText("No locked accounts.")).toBeTruthy();
  });

  it("shows the account, the reason for the lock and the gyms", () => {
    renderPanel([LOCK]);
    expect(screen.getByText("Pat")).toBeTruthy();
    expect(screen.getByText(/Too many actions in one gym within an hour/)).toBeTruthy();
    expect(screen.getByText("Gym A")).toBeTruthy();
  });

  it("paginates: 12 locks show 10 rows, then the rest on page 2", async () => {
    const user = userEvent.setup();
    renderPanel(Array.from({ length: 12 }, (_, i) => ({ ...LOCK, userId: `u${i}`, displayName: `Person ${i}` })));
    expect(screen.getAllByRole("row")).toHaveLength(11);
    await user.click(screen.getAllByRole("button", { name: /next/i })[0]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("Unlock opens a modal whose submit stays disabled until the reason is 3 to 500 characters", async () => {
    const user = userEvent.setup();
    renderPanel([LOCK]);
    await pickRowAction(user, "Pat", "Unlock");
    const m = await modal();
    const submit = m.getByRole("button", { name: "Unlock" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(m.getByPlaceholderText("Why are you doing this?"), "ab");
    expect(submit.disabled).toBe(true);
    await user.type(m.getByPlaceholderText("Why are you doing this?"), "c");
    expect(submit.disabled).toBe(false);
  });

  it("unlocks with the reason from the modal and refreshes", async () => {
    unlockSupportAccount.mockResolvedValue({ data: { code: "unlocked", assignmentId: null }, error: null });
    const user = userEvent.setup();
    const onMessage = renderPanel([LOCK]);
    await pickRowAction(user, "Pat", "Unlock");
    const m = await modal();
    await user.type(m.getByPlaceholderText("Why are you doing this?"), "checked with the person");
    await user.click(m.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(unlockSupportAccount).toHaveBeenCalledWith({ userId: "u1", reason: "checked with the person" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a refusal inside the modal and keeps it open", async () => {
    unlockSupportAccount.mockResolvedValue({ data: null, error: { code: "not_locked", message: "That account is not locked." } });
    const user = userEvent.setup();
    const onMessage = renderPanel([LOCK]);
    await pickRowAction(user, "Pat", "Unlock");
    const m = await modal();
    await user.type(m.getByPlaceholderText("Why are you doing this?"), "checked with the person");
    await user.click(m.getByRole("button", { name: "Unlock" }));
    expect(await m.findByText("That account is not locked.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("Escape closes the modal without calling the action", async () => {
    const user = userEvent.setup();
    renderPanel([LOCK]);
    await pickRowAction(user, "Pat", "Unlock");
    await modal();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(unlockSupportAccount).not.toHaveBeenCalled();
  });
});
