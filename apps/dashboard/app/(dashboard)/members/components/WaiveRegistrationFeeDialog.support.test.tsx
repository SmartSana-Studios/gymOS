/** Story 23-6c: a support session types a fresh authenticator code in the waive dialog; staff roles see no field. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const waiveRegistrationFeeAction = vi.fn();
const assign = vi.fn();

vi.mock("@/app/(dashboard)/payments/actions", () => ({
  waiveRegistrationFeeAction: (...a: unknown[]) => waiveRegistrationFeeAction(...a),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.name ? `${key}|${vars.name}` : key) }),
}));

import { WaiveRegistrationFeeDialog } from "./WaiveRegistrationFeeDialog";

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const MEMBER = { id: MEMBER_ID, name: "Alice" } as never;

async function fill(code?: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("members.feeWaive.reason"), "Friend of the owner");
  if (code) await user.type(screen.getByLabelText("supportStepUp.codeLabel"), code);
  await user.click(screen.getByRole("button", { name: "members.feeWaive.confirmButton|Alice" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  waiveRegistrationFeeAction.mockResolvedValue({ error: null });
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

describe("WaiveRegistrationFeeDialog for support (Story 23-6c)", () => {
  it("sends the code with the waiver", async () => {
    const onDone = vi.fn();
    render(<WaiveRegistrationFeeDialog member={MEMBER} isSupport onClose={vi.fn()} onDone={onDone} />);
    await fill("123456");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(waiveRegistrationFeeAction).toHaveBeenCalledWith({ memberId: MEMBER_ID, reason: "Friend of the owner", authCode: "123456" });
  });

  it("refuses a missing code before the action", async () => {
    render(<WaiveRegistrationFeeDialog member={MEMBER} isSupport onClose={vi.fn()} onDone={vi.fn()} />);
    await fill("");
    expect(await screen.findByText("supportStepUp.codeRequired")).toBeInTheDocument();
    expect(waiveRegistrationFeeAction).not.toHaveBeenCalled();
  });

  it("shows the inline message for a wrong code", async () => {
    waiveRegistrationFeeAction.mockResolvedValue({ error: { code: "invalid_code", message: "not accepted" } });
    render(<WaiveRegistrationFeeDialog member={MEMBER} isSupport onClose={vi.fn()} onDone={vi.fn()} />);
    await fill("000000");
    expect(await screen.findByText("not accepted")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("clears the spent code after an error response so a retry cannot resubmit it", async () => {
    waiveRegistrationFeeAction.mockResolvedValue({ error: { code: "invalid_code", message: "not accepted" } });
    render(<WaiveRegistrationFeeDialog member={MEMBER} isSupport onClose={vi.fn()} onDone={vi.fn()} />);
    await fill("000000");
    await screen.findByText("not accepted");
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toHaveValue("");
  });

  it("goes to the login page with the expired notice when the account locks", async () => {
    waiveRegistrationFeeAction.mockResolvedValue({ error: { code: "account_locked", message: "locked" } });
    render(<WaiveRegistrationFeeDialog member={MEMBER} isSupport onClose={vi.fn()} onDone={vi.fn()} />);
    await fill("000000");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?expired=1"));
  });

  it("a staff role sees no code field and sends no code", async () => {
    render(<WaiveRegistrationFeeDialog member={MEMBER} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.queryByLabelText("supportStepUp.codeLabel")).toBeNull();
    await fill();
    await waitFor(() => expect(waiveRegistrationFeeAction).toHaveBeenCalledWith({ memberId: MEMBER_ID, reason: "Friend of the owner" }));
  });
});
