import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const changeOwnerContact = vi.fn();
vi.mock("../../actions", () => ({ changeOwnerContact: (...a: unknown[]) => changeOwnerContact(...a) }));
vi.mock("@/components/ui/phone-input", () => ({
  PhoneInput: ({ id, onChange }: { id: string; onChange: (v?: string) => void }) => (
    <input id={id} aria-label="phone" onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { OwnerContactDialog } from "./OwnerContactDialog";
import { renderWithI18n } from "../../../support/components/support-test-utils";

const GYM = { id: "g1", name: "SmartSana Fitness" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no <dialog>.showModal
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});

describe("OwnerContactDialog", () => {
  it("sends the new email, phone and reason, then reports done", async () => {
    changeOwnerContact.mockResolvedValue({ error: null });
    const onDone = vi.fn();
    renderWithI18n(<OwnerContactDialog gym={GYM} onClose={vi.fn()} onDone={onDone} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New email"), "new@owner.test");
    await user.type(screen.getByLabelText("phone"), "+237699888777");
    await user.type(screen.getByLabelText("Reason *"), "Owner changed number");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(changeOwnerContact).toHaveBeenCalledWith("g1", { email: "new@owner.test", phone: "+237699888777", reason: "Owner changed number" }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("asks for at least one new value and a reason before calling the action", async () => {
    renderWithI18n(<OwnerContactDialog gym={GYM} onClose={vi.fn()} onDone={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Reason *"), "Owner changed number");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a new email or a new phone");
    expect(changeOwnerContact).not.toHaveBeenCalled();
  });

  it("shows the server's refusal (a phone of another account) and stays open", async () => {
    changeOwnerContact.mockResolvedValue({ error: { code: "phone_taken", message: "This phone number belongs to another account." } });
    const onDone = vi.fn();
    renderWithI18n(<OwnerContactDialog gym={GYM} onClose={vi.fn()} onDone={onDone} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("phone"), "+237699888777");
    await user.type(screen.getByLabelText("Reason *"), "Owner changed number");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("belongs to another account");
    expect(onDone).not.toHaveBeenCalled();
  });
});
