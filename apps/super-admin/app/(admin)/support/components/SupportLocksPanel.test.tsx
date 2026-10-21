import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import { RESOURCES } from "@/lib/i18n/get-server-translation";

const unlockSupportAccount = vi.fn();
vi.mock("../actions", () => ({ unlockSupportAccount: (...a: unknown[]) => unlockSupportAccount(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SupportLocksPanel } from "./SupportLocksPanel";

const LOCK = { userId: "u1", displayName: "Pat", email: "pat@gymosapps.com", lockedAt: "2026-10-21T10:00:00Z", lockedReason: "velocity_gym", gymNames: "Gym A" };

function renderPanel(locks: (typeof LOCK)[], reason: string, onMessage = vi.fn()) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: RESOURCES, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  render(
    <I18nextProvider i18n={i18n}>
      <SupportLocksPanel locks={locks} reason={reason} onMessage={onMessage} />
    </I18nextProvider>,
  );
  return onMessage;
}

describe("SupportLocksPanel", () => {
  beforeEach(() => {
    unlockSupportAccount.mockReset();
    refresh.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("says so when nothing is locked", () => {
    renderPanel([], "");
    expect(screen.getByText("No locked accounts.")).toBeTruthy();
  });

  it("shows the account, the reason for the lock and the gyms; Unlock needs a reason", () => {
    renderPanel([LOCK], "");
    expect(screen.getByText("Pat")).toBeTruthy();
    expect(screen.getByText(/Too many actions in one gym within an hour/)).toBeTruthy();
    expect(screen.getByText(/Gym A/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Unlock" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("unlocks with the recorded reason and refreshes", async () => {
    unlockSupportAccount.mockResolvedValue({ data: { code: "unlocked", assignmentId: null }, error: null });
    const onMessage = renderPanel([LOCK], "checked with the person");
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(unlockSupportAccount).toHaveBeenCalledWith({ userId: "u1", reason: "checked with the person" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a refusal instead of claiming success", async () => {
    unlockSupportAccount.mockResolvedValue({ data: null, error: { code: "not_locked", message: "That account is not locked." } });
    const onMessage = renderPanel([LOCK], "checked with the person");
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith({ kind: "error", text: "That account is not locked." }));
  });

  it("does nothing when the confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel([LOCK], "checked with the person");
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(unlockSupportAccount).not.toHaveBeenCalled();
  });
});
