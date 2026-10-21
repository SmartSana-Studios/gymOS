import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import { RESOURCES } from "@/lib/i18n/get-server-translation";

vi.mock("../actions", () => ({
  createSupportAccount: vi.fn(),
  deactivateSupportAccount: vi.fn(),
  removeSupportAccount: vi.fn(),
  sendSupportInvite: vi.fn(),
  unlockSupportAccount: vi.fn(),
  recertifySupportAccount: vi.fn(),
  startSupportFactorReset: vi.fn(),
  changeSupportContact: vi.fn(),
  runDueFactorResets: vi.fn(),
}));
vi.mock("@/components/step-up-prompt", () => ({ StepUpPrompt: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SupportPageClient } from "./SupportPageClient";
import type { SupportAccountRow, SupportLifecycleRow } from "../actions";

const LOCK = { userId: "u1", displayName: "Pat Locked", email: "pat@gymosapps.com", lockedAt: "2026-10-21T10:00:00Z", lockedReason: "velocity_gym", gymNames: "Gym A" };

function renderPage(locks?: (typeof LOCK)[]) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: RESOURCES, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  render(
    <I18nextProvider i18n={i18n}>
      <SupportPageClient initialAccounts={[]} assignments={[]} gyms={[]} locks={locks} />
    </I18nextProvider>,
  );
}

describe("SupportPageClient", () => {
  it("renders the Locked accounts panel with the lock rows it is given", () => {
    renderPage([LOCK]);
    expect(screen.getByText("Pat Locked")).toBeTruthy();
  });

  it("renders the panel's empty state when nothing is locked", () => {
    renderPage([]);
    expect(screen.getByText("No locked accounts.")).toBeTruthy();
  });

  describe("re-invite after a factor reset (Story 23.11)", () => {
    const ACCOUNT: SupportAccountRow = { userId: "u9", displayName: "Reset Person", email: "r@gymosapps.com", assignable: true, activated: true, activatedAt: "2026-10-01T10:00:00Z", inviteState: "used", inviteExpiresAt: null };
    const life = (resetState: string | null): SupportLifecycleRow => ({
      userId: "u9", displayName: "Reset Person", email: "r@gymosapps.com", activated: true, deactivated: false, lockedAt: null, lockedReason: null,
      recertifyDueAt: null, recertificationLapsed: false, resetPendingAt: resetState ? "2026-10-21T10:00:00Z" : null, resetState, resetExecutesAt: null, lastActiveAt: null,
    });
    function renderWith(lifecycle: SupportLifecycleRow[]) {
      const i18n = createInstance();
      i18n.use(initReactI18next).init({ lng: "en", resources: RESOURCES, interpolation: { escapeValue: false }, react: { useSuspense: false } });
      render(
        <I18nextProvider i18n={i18n}>
          <SupportPageClient initialAccounts={[ACCOUNT]} assignments={[]} gyms={[]} lifecycle={lifecycle} />
        </I18nextProvider>,
      );
    }

    it("an activated account shows the invite button only once its reset has been executed", () => {
      renderWith([life("executed")]);
      expect(screen.getByRole("button", { name: "Send a new invite" })).toBeTruthy();
    });

    it.each([["cooling_off"], [null]] as const)("no invite button for an activated account with reset state %s", (state) => {
      renderWith([life(state)]);
      expect(screen.queryByRole("button", { name: "Send a new invite" })).toBeNull();
    });
  });
});
