/** Changing the recovery email asks for a step-up first: the modal must open on top of the change dialog. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../../../locales/en.json";

const requestRecoveryEmailCode = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./recovery-actions", () => ({
  requestRecoveryEmailCode: (...a: unknown[]) => requestRecoveryEmailCode(...a),
  verifyRecoveryEmail: vi.fn(),
  removeRecoveryEmail: vi.fn(),
}));
vi.mock("@/app/(admin)/step-up-actions", () => ({ issueStepUp: vi.fn(async () => ({ data: { issued: true }, error: null })) }));

import { RecoverySection } from "./RecoverySection";

function renderIt() {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: enTranslations } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <RecoverySection status={{ hasEmail: true, masked: "p***@epic22qa.test", pendingApplyAt: null }} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requestRecoveryEmailCode.mockResolvedValue({ data: null, error: { code: "step_up_required", message: "stepUp.title" } });
});

describe("RecoverySection change address", () => {
  it("opens the step-up modal when the server asks for it", async () => {
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: /change/i }));
    await userEvent.type(await waitFor(() => { const el = document.getElementById("recovery-email"); if (!el) throw new Error("no input"); return el; }), "x@epic22qa.test");
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    await waitFor(() => expect(requestRecoveryEmailCode).toHaveBeenCalled());
    expect(await screen.findByRole("dialog", { name: "Confirm with your authenticator" })).toHaveAttribute("open");
  });
});

describe("a nested modal's close event", () => {
  it("does not close the change dialog (React carries it up through the portal)", async () => {
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: /change/i }));
    await userEvent.type(await waitFor(() => document.getElementById("recovery-email") as HTMLElement), "x@epic22qa.test");
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    const stepUp = await screen.findByRole("dialog", { name: "Confirm with your authenticator" });
    stepUp.dispatchEvent(new Event("close", { bubbles: true }));
    const change = document.getElementById("recovery-email")!.closest("dialog")!;
    expect(change).toHaveAttribute("open");
    expect(screen.getByRole("dialog", { name: "Confirm with your authenticator" })).toBeInTheDocument();
  });
});
