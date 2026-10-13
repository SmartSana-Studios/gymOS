/* eslint-disable i18next/no-literal-string -- test doubles render fixed marker text; no user-facing copy */
/**
 * Story 19.9b: the member modal's Sessions section and [Record session
 * payment] header action. Receptionist-and-above only (nothing for a coach);
 * the action needs Pay-per-session, a price above 0 and a charging gym; the
 * section lists unused/used/lapsed/voided rows, an empty state, and a link to
 * the Payments ledger for the member.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listMemberGuestSessionsAction = vi.fn();

vi.mock("../actions", () => ({
  createMember: vi.fn(),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: null, error: null })),
  getMemberLoyaltyAction: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/app/(dashboard)/payments/actions", () => ({
  getMemberRegistrationFeeStateAction: vi.fn(async () => ({ data: { kind: "none" }, error: null })),
  listMemberGuestSessionsAction: (...args: unknown[]) => listMemberGuestSessionsAction(...args),
}));
vi.mock("@/components/shared/RecordSessionPaymentDialog", () => ({
  RecordSessionPaymentDialog: ({
    memberName,
    role,
    onRecorded,
  }: {
    memberName: string;
    role?: string;
    onRecorded: () => void;
  }) => (
    <div>
      <p>{`record-panel:${memberName}`}</p>
      <p>{`record-panel-role:${role}`}</p>
      <button type="button" onClick={onRecorded}>
        finish-record
      </button>
    </div>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}|${Object.values(vars).join("|")}` : key,
    i18n: { language: "en" },
  }),
}));

const member = {
  id: "m1",
  name: "Alice",
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  planId: "plan-1",
  planName: "Drop-in",
  planType: "pay_per_session",
  status: "active" as const,
  expiryDate: null,
  joinDate: "2026-01-01",
  deactivatedAt: null,
  registrationFeeSettledAt: "2026-01-02T00:00:00Z",
};
const plans = [
  { id: "plan-1", name: "Drop-in", planType: "pay_per_session", price: 2000, currency: "XAF" },
] as never;

const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 10 * 86_400_000).toISOString();

const session = (overrides: Record<string, unknown>) => ({
  id: "s",
  source: "paid",
  createdAt: "2026-10-09T10:00:00Z",
  usableUntil: FUTURE,
  consumedAt: null,
  coveredDay: null,
  voidedAt: null,
  method: "cash",
  recordedByName: "Rita",
  ...overrides,
});

async function renderView(props: {
  role?: string;
  charging?: boolean;
  editing?: Record<string, unknown>;
  plans?: never;
  onSessionRecorded?: (name: string) => void;
}) {
  const { MemberModal } = await import("./MemberModal");
  render(
    <MemberModal
      open
      readOnly
      editingMember={{ ...member, ...props.editing } as never}
      plans={props.plans ?? plans}
      coaches={[]}
      role={props.role ?? "receptionist"}
      chargeGuestsPerSession={props.charging ?? true}
      onSessionRecorded={props.onSessionRecorded}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

describe("MemberModal sessions (Story 19.9b)", () => {
  beforeEach(() => {
    listMemberGuestSessionsAction.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("shows the empty state and the record action for a Pay-per-session member at a charging gym", async () => {
    await renderView({});

    expect(await screen.findByText("members.modal.sessions.empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "members.modal.recordSessionPayment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "members.modal.sessions.viewPayments" })).toHaveAttribute(
      "href",
      "/payments?memberId=m1&purpose=session",
    );
  });

  it("shows nothing session-related to a coach", async () => {
    await renderView({ role: "coach" });

    expect(listMemberGuestSessionsAction).not.toHaveBeenCalled();
    expect(screen.queryByText("members.modal.sessions.title")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "members.modal.recordSessionPayment" })).not.toBeInTheDocument();
  });

  it("hides the action when the gym is not charging, the price is 0, or the plan is not per-session", async () => {
    await renderView({ charging: false });
    expect(screen.queryByRole("button", { name: "members.modal.recordSessionPayment" })).not.toBeInTheDocument();
  });

  it("hides the action for a free (price 0) Pay-per-session plan", async () => {
    await renderView({ plans: [{ id: "plan-1", planType: "pay_per_session", price: 0, currency: "XAF" }] as never });
    expect(screen.queryByRole("button", { name: "members.modal.recordSessionPayment" })).not.toBeInTheDocument();
  });

  it("shows no Sessions section for a monthly member without session rows", async () => {
    await renderView({
      editing: { planType: "monthly", planId: "plan-2" },
      plans: [{ id: "plan-2", planType: "monthly", price: 15000, currency: "XAF" }] as never,
    });

    await waitFor(() => expect(listMemberGuestSessionsAction).toHaveBeenCalled());
    expect(screen.queryByText("members.modal.sessions.title")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "members.modal.recordSessionPayment" })).not.toBeInTheDocument();
  });

  it("lists unused, used, lapsed and voided sessions", async () => {
    listMemberGuestSessionsAction.mockResolvedValue({
      data: [
        session({ id: "u1" }),
        session({ id: "d1", consumedAt: "2026-10-08T09:00:00Z", coveredDay: "2026-10-08", usableUntil: FUTURE }),
        session({ id: "l1", usableUntil: PAST }),
        session({ id: "v1", voidedAt: "2026-10-10T09:00:00Z" }),
      ],
      error: null,
    });
    await renderView({});

    expect(await screen.findByText("members.modal.sessions.unused")).toBeInTheDocument();
    expect(screen.getByText("members.modal.sessions.used")).toBeInTheDocument();
    expect(screen.getByText(/^members\.modal\.sessions\.lapsed\|/)).toBeInTheDocument();
    expect(screen.getByText(/^members\.modal\.sessions\.voided\|/)).toBeInTheDocument();
    expect(screen.queryByText("members.modal.sessions.empty")).not.toBeInTheDocument();
  });

  it("opens the record panel, reloads sessions and reports the recording", async () => {
    const user = userEvent.setup();
    const onSessionRecorded = vi.fn();
    await renderView({ onSessionRecorded });

    await user.click(await screen.findByRole("button", { name: "members.modal.recordSessionPayment" }));
    expect(screen.getByText("record-panel:Alice")).toBeInTheDocument();
    expect(screen.getByText("record-panel-role:receptionist")).toBeInTheDocument();
    const callsBefore = listMemberGuestSessionsAction.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "finish-record" }));

    await waitFor(() => expect(listMemberGuestSessionsAction.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(onSessionRecorded).toHaveBeenCalledWith("Alice");
    expect(screen.queryByText("record-panel:Alice")).not.toBeInTheDocument();
  });

  it("still shows the Sessions section when a monthly member holds session rows", async () => {
    listMemberGuestSessionsAction.mockResolvedValue({ data: [session({ id: "u1" })], error: null });
    await renderView({
      editing: { planType: "monthly", planId: "plan-2" },
      plans: [{ id: "plan-2", planType: "monthly", price: 15000, currency: "XAF" }] as never,
    });

    expect(await screen.findByText("members.modal.sessions.title")).toBeInTheDocument();
    expect(screen.getByText("members.modal.sessions.unused")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "members.modal.recordSessionPayment" })).not.toBeInTheDocument();
  });

  it("still shows the Sessions section when the gym stopped charging but rows exist", async () => {
    listMemberGuestSessionsAction.mockResolvedValue({ data: [session({ id: "u1" })], error: null });
    await renderView({ charging: false });

    expect(await screen.findByText("members.modal.sessions.title")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "members.modal.recordSessionPayment" })).not.toBeInTheDocument();
  });

  it("offers no record action for a deactivated Pay-per-session member", async () => {
    await renderView({ editing: { deactivatedAt: "2026-10-01T00:00:00Z" } });

    await waitFor(() => expect(listMemberGuestSessionsAction).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "members.modal.recordSessionPayment" })).not.toBeInTheDocument();
  });
});
