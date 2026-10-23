/**
 * Story 18.5: the create form in a fee gym. With a registration fee above 0 the
 * Membership step omits plan, status and expiry (the first plan is assigned
 * after the fee is settled) and the createMember call carries identity fields
 * and the join date only. With fee 0 the one-step form is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createMember = vi.fn();
const editMember = vi.fn();

vi.mock("../actions", () => ({
  createMember: (...args: unknown[]) => createMember(...args),
  editMember: (...args: unknown[]) => editMember(...args),
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

describe("MemberModal profile fields (Story 26.1)", () => {
  beforeEach(() => {
    createMember.mockReset();
    createMember.mockResolvedValue({ data: { id: "member-1" }, error: null });
  });

  async function advanceFeeGym(user: ReturnType<typeof userEvent.setup>, extra: () => Promise<void>) {
    await renderModal(5000);
    await user.type(document.getElementById("memberName") as HTMLInputElement, "Alice Mballa");
    const phone = document.getElementById("memberPhone") as HTMLInputElement;
    await user.clear(phone);
    await user.type(phone, "+237680811041");
    await extra();
    await user.click(screen.getByRole("button", { name: "common.next" }));
    await user.click(await screen.findByRole("button", { name: "members.addMemberButton" }));
  }

  it("sends the three values, trimmed, as a number and strings", async () => {
    const user = userEvent.setup();
    await advanceFeeGym(user, async () => {
      await user.type(document.getElementById("memberBirthYear") as HTMLInputElement, "1984");
      await user.type(document.getElementById("memberProfession") as HTMLInputElement, " Soudeur ");
      await user.type(document.getElementById("memberNeighborhood") as HTMLInputElement, "Ngui");
    });
    await waitFor(() => expect(createMember).toHaveBeenCalledTimes(1));
    expect(createMember.mock.calls[0][0]).toMatchObject({ birthYear: 1984, profession: "Soudeur", neighborhood: "Ngui" });
  });

  it("sends null for all three when left blank", async () => {
    const user = userEvent.setup();
    await advanceFeeGym(user, async () => {});
    await waitFor(() => expect(createMember).toHaveBeenCalledTimes(1));
    expect(createMember.mock.calls[0][0]).toMatchObject({ birthYear: null, profession: null, neighborhood: null });
  });

  it.each(["1850", "84", "abc", "9999"])("refuses birth year %s inline and writes nothing", async (value) => {
    const user = userEvent.setup();
    await renderModal(5000);
    await user.type(document.getElementById("memberName") as HTMLInputElement, "Alice Mballa");
    const phone = document.getElementById("memberPhone") as HTMLInputElement;
    await user.clear(phone);
    await user.type(phone, "+237680811041");
    await user.type(document.getElementById("memberBirthYear") as HTMLInputElement, value);
    await user.click(screen.getByRole("button", { name: "common.next" }));
    await user.click(await screen.findByRole("button", { name: "members.addMemberButton" }));

    expect(await screen.findByText("members.modal.errors.birthYearInvalid")).toBeInTheDocument();
    expect(createMember).not.toHaveBeenCalled();
  });

  it("refuses a 121-character profession inline", async () => {
    const user = userEvent.setup();
    await renderModal(5000);
    await user.type(document.getElementById("memberName") as HTMLInputElement, "Alice Mballa");
    const phone = document.getElementById("memberPhone") as HTMLInputElement;
    await user.clear(phone);
    await user.type(phone, "+237680811041");
    fireEvent.change(document.getElementById("memberProfession") as HTMLInputElement, {
      target: { value: "x".repeat(121) },
    });
    await user.click(screen.getByRole("button", { name: "common.next" }));
    await user.click(await screen.findByRole("button", { name: "members.addMemberButton" }));

    expect(await screen.findByText("members.modal.errors.professionInvalid")).toBeInTheDocument();
    expect(createMember).not.toHaveBeenCalled();
  });

  it("editing: clearing the profession saves null and keeps the other two values", async () => {
    editMember.mockReset();
    editMember.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    const { MemberModal } = await import("./MemberModal");
    render(
      <MemberModal
        open
        readOnly={false}
        editingMember={
          {
            id: "m1", name: "Test Member", phone: "+237600000001", email: null, dob: null, photoUrl: null,
            emergencyContact: null, birthYear: 1984, profession: "Soudeur", neighborhood: "Ngui",
            planId: null, planName: null, planType: null, status: "no_active_plan", expiryDate: null,
            joinDate: "2026-01-15", deactivatedAt: null, registrationFeeSettledAt: "2026-01-15T00:00:00Z",
          } as never
        }
        plans={plans}
        coaches={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.clear(document.getElementById("memberProfession") as HTMLInputElement);
    await user.click(screen.getByRole("button", { name: "members.modal.saveChanges" }));

    await waitFor(() => expect(editMember).toHaveBeenCalledTimes(1));
    expect(editMember.mock.calls[0][0]).toBe("m1");
    expect(editMember.mock.calls[0][1]).toMatchObject({ birthYear: 1984, profession: null, neighborhood: "Ngui" });
  });

  describe("detail view", () => {
    const member = {
      id: "m1", name: "Test Member", phone: "+237600000001", email: null, dob: null, photoUrl: null,
      emergencyContact: null, birthYear: 1984, profession: "Soudeur", neighborhood: "Ngui",
      planId: null, planName: null, planType: null, status: "no_active_plan", expiryDate: null,
      joinDate: "2026-01-15", deactivatedAt: null, registrationFeeSettledAt: "2026-01-15T00:00:00Z",
    };

    async function renderView(overrides: Record<string, unknown>) {
      const { MemberModal } = await import("./MemberModal");
      render(
        <MemberModal
          open
          readOnly
          editingMember={{ ...member, ...overrides } as never}
          plans={plans}
          coaches={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    }

    it("shows an approximate age, profession and neighborhood", async () => {
      await renderView({});
      expect(screen.getByText("members.modal.view.approxAge")).toBeInTheDocument();
      expect(screen.getByText("members.modal.view.approxAgeValue")).toBeInTheDocument();
      expect(screen.getByText("Soudeur")).toBeInTheDocument();
      expect(screen.getByText("Ngui")).toBeInTheDocument();
    });

    it("shows nothing for a member without a birth year", async () => {
      await renderView({ birthYear: null, profession: null, neighborhood: null });
      expect(screen.queryByText("members.modal.view.approxAge")).toBeNull();
      expect(screen.queryByText("members.modal.profession")).toBeNull();
    });
  });
});
