/** Story 23-6c: a support session types a fresh authenticator code in the Add Staff dialog; staff roles see no field. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createStaffMemberAction = vi.fn();
const assign = vi.fn();

vi.mock("../actions", () => ({ createStaffMemberAction: (...a: unknown[]) => createStaffMemberAction(...a) }));
vi.mock("@/components/ui/phone-input", () => ({
  PhoneInput: ({ id, onChange }: { id: string; onChange: (v: string) => void }) => (
    <input id={id} aria-label="phone" onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { AddStaffModal } from "./AddStaffModal";

async function submit(callerRole: "support" | "owner", code?: string) {
  const onCreated = vi.fn();
  const user = userEvent.setup();
  render(<AddStaffModal open callerRole={callerRole} onClose={vi.fn()} onCreated={onCreated} />);
  await user.type(screen.getByLabelText("staff.modal.name"), "Jane Coach");
  await user.type(screen.getByLabelText("phone"), "+237680811041");
  await user.selectOptions(screen.getByLabelText("staff.modal.role"), "coach");
  if (code) await user.type(screen.getByLabelText("supportStepUp.codeLabel"), code);
  await user.click(screen.getByRole("button", { name: "staff.modal.create" }));
  return { onCreated };
}

beforeEach(() => {
  vi.clearAllMocks();
  createStaffMemberAction.mockResolvedValue({ data: { tempPassword: "x", smsSent: true, isExistingAccount: false }, error: null });
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

describe("AddStaffModal for support (Story 23-6c)", () => {
  it("sends the code with the new staff member", async () => {
    const { onCreated } = await submit("support", "123456");
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createStaffMemberAction).toHaveBeenCalledWith(expect.objectContaining({ role: "coach", authCode: "123456" }));
  });

  it("refuses a missing code before the action", async () => {
    await submit("support", "");
    expect(await screen.findByText("supportStepUp.codeRequired")).toBeInTheDocument();
    expect(createStaffMemberAction).not.toHaveBeenCalled();
  });

  it("shows the inline message for a wrong code", async () => {
    createStaffMemberAction.mockResolvedValue({ data: null, error: { code: "invalid_code", message: "not accepted" } });
    await submit("support", "000000");
    expect(await screen.findByText("not accepted")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("clears the spent code after an error response so a retry cannot resubmit it", async () => {
    createStaffMemberAction.mockResolvedValue({ data: null, error: { code: "invalid_code", message: "not accepted" } });
    await submit("support", "000000");
    await screen.findByText("not accepted");
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toHaveValue("");
  });

  it("starts with an empty code every time the dialog is opened", async () => {
    const user = userEvent.setup();
    const props = { callerRole: "support" as const, onClose: vi.fn(), onCreated: vi.fn() };
    const { rerender } = render(<AddStaffModal open {...props} />);
    await user.type(screen.getByLabelText("supportStepUp.codeLabel"), "123456");
    rerender(<AddStaffModal open={false} {...props} />);
    rerender(<AddStaffModal open {...props} />);
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toHaveValue("");
  });

  it("goes to the login page with the expired notice when the account locks", async () => {
    createStaffMemberAction.mockResolvedValue({ data: null, error: { code: "account_locked", message: "locked" } });
    await submit("support", "000000");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?expired=1"));
  });

  it("an Owner sees no code field and sends no code", async () => {
    const { onCreated } = await submit("owner");
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.queryByLabelText("supportStepUp.codeLabel")).toBeNull();
    expect(createStaffMemberAction.mock.calls[0][0]).not.toHaveProperty("authCode");
  });
});
