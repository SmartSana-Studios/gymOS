/**
 * Story 27.4 (UX AD-04, owner decision 2026-11-18): [Correct plan] sits in the row menu between Edit and Send invite and is passed to the
 * member modal. It is gated like Edit (Owner, Supervisor, Manager, GymOS Support) and absent from the DOM for Receptionist and Coach, and
 * for a member with no current subscription. Choosing it opens the Correct plan modal; a correction refreshes the page and shows the toast
 * with the new plan, expiry and status.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
let corrected: ((result: { planName: string; planType: string; expiryDate: string | null; status: string }) => void) | null = null;
const memberModalProps: { current: { onCorrectPlan?: unknown; editingMember?: { planName: string | null } | null } | null } = { current: null };
const modalProps = () => memberModalProps.current;

vi.mock("../actions", () => ({ sendMemberInvite: vi.fn(), exportMembersCsv: vi.fn() }));
vi.mock("@/app/(dashboard)/payments/actions", () => ({ waiveRegistrationFeeAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => "/members",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("./MemberModal", () => ({
  MemberModal: (props: {
    onCorrectPlan?: (member: unknown, trigger: HTMLButtonElement | null) => void;
    editingMember?: { planName: string | null } | null;
  }) => {
    memberModalProps.current = props;
    // the View modal's own [Correct plan] button, which hands the page its element so focus can return to it
    return props.onCorrectPlan ? (
      <button type="button" aria-label="view-correct" onClick={(e) => props.onCorrectPlan?.(props.editingMember, e.currentTarget)} />
    ) : null;
  },
}));
vi.mock("./CorrectPlanModal", () => ({
  CorrectPlanModal: (props: { member: { name: string }; isSupport: boolean; onClose: () => void; onCorrected: typeof corrected }) => {
    corrected = props.onCorrected;
    return (
      <div role="dialog" aria-label="correct-plan">
        {props.member.name}:{String(props.isSupport)}
        <button type="button" aria-label="close-correct" onClick={props.onClose} />
      </div>
    );
  },
}));
vi.mock("./DeactivateMemberDialog", () => ({ DeactivateMemberDialog: () => null }));
vi.mock("./CsvImportModal", () => ({ CsvImportModal: () => null }));
vi.mock("./InviteMemberModal", () => ({ InviteMemberModal: () => null }));
vi.mock("./CollectRegistrationFeeDialog", () => ({ CollectRegistrationFeeDialog: () => null }));
vi.mock("./VoidRegistrationFeeDialog", () => ({ VoidRegistrationFeeDialog: () => null }));
vi.mock("./AssignInitialPlanDialog", () => ({ AssignInitialPlanDialog: () => null }));

const withPlan = {
  id: "m-1", name: "Ange T.", phone: "+237680811041", email: null, dob: null, photoUrl: null, emergencyContact: null,
  planId: "p-1", planName: "ANNUAL", planType: "monthly", status: "active" as const, expiryDate: "2027-11-02", joinDate: "2026-01-01",
  deactivatedAt: null, registrationFeeSettledAt: "2026-01-01T00:00:00Z", subscriptionId: "s-1", subscriptionStartDate: "2026-11-02",
};
const noPlan = { ...withPlan, id: "m-2", name: "Nina N.", planId: null, planName: null, planType: null, status: "no_active_plan" as const, expiryDate: null, subscriptionId: null, subscriptionStartDate: null };

async function renderPage(role: string, members: unknown[] = [withPlan]) {
  const { MembersPageClient } = await import("./MembersPageClient");
  render(
    <MembersPageClient
      initialMembers={members as never}
      total={members.length}
      page={1}
      pageSize={25}
      search=""
      status=""
      role={role as never}
      plans={[]}
      coaches={[]}
      gymName="Iron Gym"
    />,
  );
}

async function openMenu(name: RegExp = /members.actions.menu/) {
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name })[0]);
  return user;
}

describe("[Correct plan] on the members page (Story 27.4)", () => {
  it.each(["owner", "supervisor", "manager", "support"])("%s: the row menu offers it, between Edit and Send invite", async (role) => {
    await renderPage(role);
    await openMenu();
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent ?? "");
    const edit = items.findIndex((t) => t.includes("members.actions.edit"));
    const correct = items.findIndex((t) => t.includes("members.correctPlan.action"));
    const invite = items.findIndex((t) => t.includes("members.actions.invite"));
    expect(correct).toBeGreaterThan(edit);
    expect(correct).toBeLessThan(invite);
  });

  it.each(["receptionist", "coach"])("%s: absent from the DOM", async (role) => {
    await renderPage(role);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /members.correctPlan.action/ })).toBeNull();
  });

  it("a member with no current subscription: absent for a Manager", async () => {
    await renderPage("manager", [noPlan]);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /members.correctPlan.action/ })).toBeNull();
  });

  it("a deactivated member: absent for a Manager (27-4 review)", async () => {
    await renderPage("manager", [{ ...withPlan, deactivatedAt: "2026-11-10T09:00:00Z" }]);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /members.correctPlan.action/ })).toBeNull();
  });

  it("the member modal gets the handler only for roles that may edit", async () => {
    // The modal is mounted by the page only when a row is opened.
    await renderPage("manager");
    const user = userEvent.setup();
    await user.click(screen.getByText("Ange T."));
    expect(modalProps()?.onCorrectPlan).toBeTypeOf("function");
  });

  it("a Receptionist's member modal gets no handler", async () => {
    memberModalProps.current = null;
    await renderPage("receptionist");
    const user = userEvent.setup();
    await user.click(screen.getByText("Ange T."));
    expect(modalProps()).not.toBeNull();
    expect(modalProps()?.onCorrectPlan).toBeUndefined();
  });

  it("choosing it opens the modal for that member; a correction refreshes the page and shows the toast", async () => {
    await renderPage("manager");
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /members.correctPlan.action/ }));
    expect(screen.getByRole("dialog", { name: "correct-plan" })).toHaveTextContent("Ange T.:false");
    corrected?.({ planName: "MONTHLY", planType: "monthly", expiryDate: "2026-12-02", status: "active" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent('members.correctPlan.success {"name":"Ange T.","plan":"MONTHLY","date":"02 Dec 2026","status":"members.status.active"}');
    expect(screen.queryByRole("dialog", { name: "correct-plan" })).toBeNull();
  });

  it("an expired result and a Pay-per-session result use their own wording", async () => {
    await renderPage("manager");
    let user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /members.correctPlan.action/ }));
    corrected?.({ planName: "MONTHLY", planType: "monthly", expiryDate: "2026-10-02", status: "expired" });
    expect(await screen.findByRole("status")).toHaveTextContent("members.correctPlan.successExpired");
    user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /members.correctPlan.action/ }));
    corrected?.({ planName: "DROP-IN", planType: "pay_per_session", expiryDate: null, status: "active" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("members.correctPlan.successPps"));
  });

  it("support: the modal is told it is a support session", async () => {
    await renderPage("support");
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /members.correctPlan.action/ }));
    expect(screen.getByRole("dialog", { name: "correct-plan" })).toHaveTextContent("Ange T.:true");
  });

  it("after a refresh the open View modal follows its member's fresh row (plan changes in place)", async () => {
    const { MembersPageClient } = await import("./MembersPageClient");
    const props = { total: 1, page: 1, pageSize: 25, search: "", status: "", role: "manager" as never, plans: [], coaches: [], gymName: "Iron Gym" };
    const { rerender } = render(<MembersPageClient {...props} initialMembers={[withPlan] as never} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Ange T."));
    expect(modalProps()?.editingMember?.planName).toBe("ANNUAL");
    // router.refresh() re-reads the list: a new object for the same member
    rerender(<MembersPageClient {...props} initialMembers={[{ ...withPlan, planName: "MONTHLY" }] as never} />);
    await waitFor(() => expect(modalProps()?.editingMember?.planName).toBe("MONTHLY"));
  });

  it("when the corrected member leaves the refreshed list (a filter drops them), the open View modal closes instead of showing the old plan (27-4 review)", async () => {
    const { MembersPageClient } = await import("./MembersPageClient");
    const props = { total: 1, page: 1, pageSize: 25, search: "", status: "expired", role: "manager" as never, plans: [], coaches: [], gymName: "Iron Gym" };
    const { rerender } = render(<MembersPageClient {...props} initialMembers={[withPlan] as never} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Ange T."));
    await user.click(screen.getByRole("button", { name: "view-correct" }));
    corrected?.({ planName: "MONTHLY", planType: "monthly", expiryDate: "2026-12-02", status: "active" });
    rerender(<MembersPageClient {...props} total={0} initialMembers={[] as never} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "view-correct" })).toBeNull());
  });

  it("a View modal that was NOT just corrected stays open when its member leaves the list", async () => {
    const { MembersPageClient } = await import("./MembersPageClient");
    const props = { total: 1, page: 1, pageSize: 25, search: "", status: "", role: "manager" as never, plans: [], coaches: [], gymName: "Iron Gym" };
    const { rerender } = render(<MembersPageClient {...props} initialMembers={[withPlan] as never} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Ange T."));
    rerender(<MembersPageClient {...props} total={0} initialMembers={[] as never} />);
    expect(screen.getByRole("button", { name: "view-correct" })).toBeInTheDocument();
  });

  it("focus returns to the row's Actions button after the modal closes", async () => {
    await renderPage("manager");
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /members.correctPlan.action/ }));
    await user.click(screen.getByRole("button", { name: "close-correct" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /members.actions.menu/ })).toHaveFocus());
  });

  it("focus returns to the View modal's [Correct plan] button after a correction", async () => {
    await renderPage("manager");
    const user = userEvent.setup();
    await user.click(screen.getByText("Ange T."));
    const opener = screen.getByRole("button", { name: "view-correct" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "correct-plan" })).toBeInTheDocument();
    corrected?.({ planName: "MONTHLY", planType: "monthly", expiryDate: "2026-12-02", status: "active" });
    await waitFor(() => expect(screen.getByRole("button", { name: "view-correct" })).toHaveFocus());
  });
});
