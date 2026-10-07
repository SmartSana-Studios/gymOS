/**
 * Story 18.5: the create form in a fee gym. With a registration fee above 0 the
 * Membership step omits plan, status and expiry (the first plan is assigned
 * after the fee is settled) and the createMember call carries identity fields
 * and the join date only. With fee 0 the one-step form is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createMember = vi.fn();

vi.mock("../actions", () => ({
  createMember: (...args: unknown[]) => createMember(...args),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("@/components/ui/phone-input", () => ({
  PhoneInput: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const plans = [
  {
    id: "plan-1",
    name: "Monthly",
    planType: "recurring",
    billingInterval: "monthly",
    durationDays: 30,
  },
] as never;

async function renderModal(registrationFee: number | undefined) {
  const { MemberModal } = await import("./MemberModal");
  const onSaved = vi.fn();
  render(
    <MemberModal
      open
      readOnly={false}
      editingMember={null}
      plans={plans}
      coaches={[]}
      registrationFee={registrationFee}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

async function fillIdentityAndAdvance(user: ReturnType<typeof userEvent.setup>) {
  await user.type(document.getElementById("memberName") as HTMLInputElement, "Alice Mballa");
  const phone = document.getElementById("memberPhone") as HTMLInputElement;
  await user.clear(phone);
  await user.type(phone, "+237680811041");
  await user.click(screen.getByRole("button", { name: "common.next" }));
}

describe("MemberModal create (Story 18.5)", () => {
  beforeEach(() => {
    createMember.mockReset();
    createMember.mockResolvedValue({ data: { id: "member-1" }, error: null });
  });

  it("fee above 0: step 2 omits plan, status and expiry and shows the fee notice and join date", async () => {
    const user = userEvent.setup();
    await renderModal(5000);

    await fillIdentityAndAdvance(user);

    expect(await screen.findByText("members.modal.registrationFeeNotice")).toBeInTheDocument();
    expect(document.getElementById("memberJoinDate")).toBeInTheDocument();
    expect(document.getElementById("memberPlan")).toBeNull();
    expect(document.getElementById("memberSubscriptionStatus")).toBeNull();
    expect(document.getElementById("memberExpiryDate")).toBeNull();
  });

  it("fee above 0: createMember is called with identity fields and join date only", async () => {
    const user = userEvent.setup();
    const { onSaved } = await renderModal(5000);

    await fillIdentityAndAdvance(user);
    await user.click(await screen.findByRole("button", { name: "members.addMemberButton" }));

    await waitFor(() => expect(createMember).toHaveBeenCalledTimes(1));
    const payload = createMember.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ name: "Alice Mballa", phone: "+237680811041" });
    expect(payload).toHaveProperty("joinDate");
    expect(payload).not.toHaveProperty("planId");
    expect(payload).not.toHaveProperty("subscriptionStatus");
    expect(payload).not.toHaveProperty("expiryDate");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("fee 0: the plan, status and expiry fields are still on step 2 and the notice is absent", async () => {
    const user = userEvent.setup();
    await renderModal(0);

    await fillIdentityAndAdvance(user);

    expect(await screen.findByLabelText("members.modal.plan")).toBeInTheDocument();
    expect(document.getElementById("memberSubscriptionStatus")).toBeInTheDocument();
    expect(document.getElementById("memberExpiryDate")).toBeInTheDocument();
    expect(screen.queryByText("members.modal.registrationFeeNotice")).toBeNull();
  });

  it("fee 0 (prop omitted): selecting a plan sends the full one-step payload", async () => {
    const user = userEvent.setup();
    await renderModal(undefined);

    await fillIdentityAndAdvance(user);
    await user.selectOptions(await screen.findByLabelText("members.modal.plan"), "plan-1");
    await user.click(screen.getByRole("button", { name: "members.addMemberButton" }));

    await waitFor(() => expect(createMember).toHaveBeenCalledTimes(1));
    expect(createMember.mock.calls[0][0]).toMatchObject({
      planId: "plan-1",
      subscriptionStatus: "active",
    });
  });
});
