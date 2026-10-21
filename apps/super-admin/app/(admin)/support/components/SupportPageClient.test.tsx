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
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SupportPageClient } from "./SupportPageClient";

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
});
