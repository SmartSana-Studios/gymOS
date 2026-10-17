/** The step-up modal opens on top of Add admin; its close event must not close or reset the dialog under it. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../../../../locales/en.json";

const createOrPromoteSuperAdmin = vi.fn();
vi.mock("../actions", () => ({ createOrPromoteSuperAdmin: (...a: unknown[]) => createOrPromoteSuperAdmin(...a) }));
vi.mock("@/app/(admin)/step-up-actions", () => ({ issueStepUp: vi.fn(async () => ({ data: { issued: true }, error: null })) }));

import { AddAdminModal } from "./AddAdminModal";

const onClose = vi.fn();

function renderIt() {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: enTranslations } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <AddAdminModal open onClose={onClose} onDone={vi.fn()} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createOrPromoteSuperAdmin.mockResolvedValue({ data: null, error: { code: "step_up_required", message: "stepUp.title" } });
});

describe("AddAdminModal with the step-up modal on top", () => {
  it("keeps its fields and stays open when the nested modal's close event reaches it", async () => {
    renderIt();
    await userEvent.type(await waitFor(() => document.getElementById("email") as HTMLElement), "new@example.com");
    await userEvent.type(document.getElementById("currentPassword") as HTMLElement, "pw-123456");
    await userEvent.click(screen.getAllByRole("button").find((b) => /add/i.test(b.textContent ?? "") && (b as HTMLButtonElement).type === "submit")!);
    const stepUp = await screen.findByRole("dialog", { name: "Confirm with your authenticator" });

    // A close event that did not come from this dialog itself (what the nested modal's close looked like to it).
    expect(stepUp).toBeInTheDocument();
    document.getElementById("email")!.dispatchEvent(new Event("close", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
    expect((document.getElementById("email") as HTMLInputElement).value).toBe("new@example.com");
    expect(document.getElementById("email")!.closest("dialog")).toHaveAttribute("open");
  });
});
