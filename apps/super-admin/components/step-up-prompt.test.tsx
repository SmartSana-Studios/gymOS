/** Story 22.7 / 22.8: the step-up prompt is a modal, submits once, and never reaches a surrounding form. */
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../locales/en.json";

const issueStepUp = vi.fn();
vi.mock("@/app/(admin)/step-up-actions", () => ({ issueStepUp: (...a: unknown[]) => issueStepUp(...a) }));

import { StepUpPrompt } from "./step-up-prompt";

const onIssued = vi.fn();
const onCancel = vi.fn();
const parentSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

function renderPrompt() {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: enTranslations } } });
  // StrictMode re-mounts effects in dev: the prompt must survive it (it used to cancel itself).
  return render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <form onSubmit={parentSubmit} data-testid="parent">
          <StepUpPrompt action="remove_super_admin_factor" subjectId="f1" onIssued={onIssued} onCancel={onCancel} />
        </form>
      </I18nextProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  issueStepUp.mockResolvedValue({ data: { issued: true }, error: null });
});

describe("StepUpPrompt", () => {
  it("opens as a modal dialog rendered outside the surrounding form", () => {
    renderPrompt();
    const dialog = screen.getByRole("dialog", { name: "Confirm with your authenticator" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByTestId("parent").contains(dialog)).toBe(false);
  });

  it("pressing Enter submits the prompt once and never the parent form", async () => {
    renderPrompt();
    await userEvent.type(screen.getByLabelText(/code/i), "123456{Enter}");
    await waitFor(() => expect(onIssued).toHaveBeenCalledTimes(1));
    expect(issueStepUp).toHaveBeenCalledTimes(1);
    expect(issueStepUp).toHaveBeenCalledWith({ action: "remove_super_admin_factor", subjectId: "f1", code: "123456" });
    expect(parentSubmit).not.toHaveBeenCalled();
  });

  it("a wrong code shows the error and the prompt stays open for a retry", async () => {
    issueStepUp.mockResolvedValueOnce({ data: null, error: { code: "invalid_code", message: "That code is not valid." } });
    renderPrompt();
    await userEvent.type(screen.getByLabelText(/code/i), "000000{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not valid.");
    expect(onIssued).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Confirm with your authenticator" })).toHaveAttribute("open");
    await userEvent.type(screen.getByLabelText(/code/i), "123456{Enter}");
    await waitFor(() => expect(onIssued).toHaveBeenCalledTimes(1));
  });

  it("stays open after mounting under StrictMode (does not cancel itself)", async () => {
    renderPrompt();
    await new Promise((r) => setTimeout(r, 20));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Confirm with your authenticator" })).toHaveAttribute("open");
  });

  it("Esc cancels it", () => {
    renderPrompt();
    screen.getByRole("dialog", { name: "Confirm with your authenticator" }).dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancel calls onCancel and issues nothing", async () => {
    renderPrompt();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(issueStepUp).not.toHaveBeenCalled();
  });
});
