/**
 * Story 27.3, UX AD-30: the Check in a member modal. Step 1 (auto-focused search, 300 ms debounce, thresholds, radio rows, the entry-time
 * line without a time or date field, a confirm button named for the person) and every result state R1 to R12: its text, role and tone, and
 * the actions listed in EXPERIENCE.md. The two in-place compositions are driven through the real shared panels: renew then complete (R4
 * to R6), pay then complete (R5 to R6), the failure variant R10 retrying ONLY the check-in (the payment function is called once), and a
 * double submit reaching the server once. The translation function returns the key (plus its variables) so the keys are what is pinned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const searchMembersForCheckInAction = vi.fn();
const staffCheckInAction = vi.fn();
const recordSessionPaymentAction = vi.fn();
const getSessionPaymentPanelContextAction = vi.fn();
const getRenewalPreviewAction = vi.fn();
const confirmRenewalAction = vi.fn();

vi.mock("../actions", () => ({
  searchMembersForCheckInAction: (...args: unknown[]) => searchMembersForCheckInAction(...args),
  staffCheckInAction: (...args: unknown[]) => staffCheckInAction(...args),
}));
vi.mock("@/app/(dashboard)/payments/actions", () => ({
  recordSessionPaymentAction: (...args: unknown[]) => recordSessionPaymentAction(...args),
  getSessionPaymentPanelContextAction: (...args: unknown[]) => getSessionPaymentPanelContextAction(...args),
  initiatePaymentAction: vi.fn(),
  getPendingMobileMoneyPaymentAction: vi.fn(async () => ({ data: null })),
}));
vi.mock("@/app/(dashboard)/subscriptions/actions", () => ({
  getRenewalPreviewAction: (...args: unknown[]) => getRenewalPreviewAction(...args),
  confirmRenewalAction: (...args: unknown[]) => confirmRenewalAction(...args),
}));
vi.mock("@/lib/realtime/frontDeskAlerts", () => ({ dismissFrontDeskAlert: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/realtime/paymentStatus", () => ({ subscribeToPaymentStatus: vi.fn(), fetchPaymentStatus: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ removeChannel: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));

import { CheckInMemberModal } from "./CheckInMemberModal";

const ANGE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ange M.",
  phone: "+237655443322",
  photoUrl: null,
  planName: "Monthly",
  status: "expiring_soon",
  deactivatedAt: null,
  insideSince: null,
};

function mkRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ ...ANGE, id: `00000000-0000-4000-8000-00000000000${i}`, name: `Member ${i}` }));
}

function result(partial: Record<string, unknown>) {
  return {
    outcome: "checked_in",
    attendanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    checkedInAt: "2026-11-15T07:02:00.000Z",
    memberStatus: "active",
    expiryDate: null,
    daysSinceExpiry: null,
    graceEndsOn: null,
    since: null,
    sessionAmount: null,
    ...partial,
  };
}

/** Text of an element whose rendered string is `key` or `key {vars}`. */
function textOf(key: string) {
  return screen.getByText((content) => content === key || content.startsWith(`${key} {`));
}
function queryTextOf(key: string) {
  return screen.queryByText((content) => content === key || content.startsWith(`${key} {`));
}
function buttonOf(key: string) {
  return screen.getByRole("button", { name: (name) => name === key || name.startsWith(`${key} {`) });
}

async function openAndChoose(user: ReturnType<typeof userEvent.setup>, rows = [ANGE]) {
  searchMembersForCheckInAction.mockResolvedValue({ data: { rows, hasMore: false }, error: null });
  await user.type(screen.getByRole("textbox"), "Ange");
  await waitFor(() => expect(screen.getAllByRole("radio").length).toBe(rows.length));
  await user.click(screen.getAllByRole("radio")[0]);
}

function setup(props: { role?: string } = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const user = userEvent.setup();
  render(<CheckInMemberModal role={props.role ?? "receptionist"} mobileMoneyEnabled={false} onClose={onClose} onChanged={onChanged} />);
  return { user, onClose, onChanged };
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

describe("CheckInMemberModal step 1 (AD-30)", () => {
  beforeEach(() => {
    setOnline(true);
    searchMembersForCheckInAction.mockReset().mockResolvedValue({ data: { rows: [], hasMore: false }, error: null });
    staffCheckInAction.mockReset();
  });

  it("opens with the search auto-focused, the hint, the entry-time line and no time or date field", () => {
    setup();
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(textOf("attendance.checkIn.search.hint")).toBeInTheDocument();
    expect(textOf("attendance.checkIn.entryTime")).toBeInTheDocument();
    expect(document.querySelector('input[type="date"], input[type="time"], input[type="datetime-local"]')).toBeNull();
    // the confirm is named by the action and disabled until a row is chosen
    expect(buttonOf("attendance.checkIn.action")).toBeDisabled();
  });

  it("queries nothing under 2 letters or 3 digits, and once after the 300 ms debounce", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox"), "A");
    await new Promise((r) => setTimeout(r, 450));
    expect(searchMembersForCheckInAction).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox"), "ng");
    await waitFor(() => expect(searchMembersForCheckInAction).toHaveBeenCalledTimes(1));
    expect(searchMembersForCheckInAction).toHaveBeenCalledWith("Ang");
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "67");
    await new Promise((r) => setTimeout(r, 450));
    expect(searchMembersForCheckInAction).toHaveBeenCalledTimes(1);
    await user.type(screen.getByRole("textbox"), "0");
    await waitFor(() => expect(searchMembersForCheckInAction).toHaveBeenCalledTimes(2));
  });

  it("lists rows as radio options with name, phone, plan, status and the muted 'in the gym since' tag", async () => {
    const { user } = setup();
    searchMembersForCheckInAction.mockResolvedValue({
      data: { rows: [{ ...ANGE, insideSince: "2026-11-15T06:40:00.000Z" }], hasMore: false },
      error: null,
    });
    await user.type(screen.getByRole("textbox"), "Ange");
    const radio = await screen.findByRole("radio");
    const row = radio.closest("label") as HTMLElement;
    expect(within(row).getByText("Ange M.")).toBeInTheDocument();
    expect(within(row).getByText("+237655443322")).toBeInTheDocument();
    expect(within(row).getByText("Monthly")).toBeInTheDocument();
    expect(within(row).getByText("members.status.expiringSoon")).toBeInTheDocument();
    expect(within(row).getByText((c) => c.startsWith("attendance.checkIn.row.inside"))).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("says 'Showing the first 8' when more match, and names the confirm button after the chosen member", async () => {
    const { user } = setup();
    searchMembersForCheckInAction.mockResolvedValue({ data: { rows: mkRows(8), hasMore: true }, error: null });
    await user.type(screen.getByRole("textbox"), "Mem");
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(8));
    expect(textOf("attendance.checkIn.search.more")).toBeInTheDocument();
    await user.click(screen.getAllByRole("radio")[1]);
    expect(buttonOf("attendance.checkIn.confirm")).toHaveTextContent("Member 1");
    expect(buttonOf("attendance.checkIn.confirm")).toBeEnabled();
  });

  it("says so when nothing matches and offers a retry when the search fails", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox"), "Zzz");
    await waitFor(() => expect(queryTextOf("attendance.checkIn.search.none")).toBeInTheDocument());
    searchMembersForCheckInAction.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    await user.type(screen.getByRole("textbox"), "z");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("attendance.checkIn.search.error")).toBeInTheDocument();
    searchMembersForCheckInAction.mockResolvedValue({ data: { rows: [ANGE], hasMore: false }, error: null });
    await user.click(within(alert).getByRole("button", { name: "attendance.checkIn.search.retry" }));
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(1));
  });
});

describe("CheckInMemberModal results R1 to R12 (AD-30)", () => {
  beforeEach(() => {
    setOnline(true);
    searchMembersForCheckInAction.mockReset();
    staffCheckInAction.mockReset();
    recordSessionPaymentAction.mockReset();
    getSessionPaymentPanelContextAction.mockReset().mockResolvedValue({
      data: { planName: "Drop-in", planType: "pay_per_session", price: 2000, currency: "XAF", recordedByName: "Rita Desk" },
      error: null,
    });
    getRenewalPreviewAction.mockReset().mockResolvedValue({
      data: { planName: "Monthly", price: 15000, currency: "XAF", memberPhone: null },
      error: null,
    });
    confirmRenewalAction.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("R1: checked in, role status, [Check in another member] and [Done]; the server got only the member id", async () => {
    const { user, onChanged } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    const text = await screen.findByText((c) => c.startsWith("attendance.checkIn.ok "));
    expect(text.closest('[role="status"]')).not.toBeNull();
    expect(staffCheckInAction).toHaveBeenCalledWith({ memberId: ANGE.id });
    expect(buttonOf("attendance.checkIn.another")).toBeInTheDocument();
    expect(buttonOf("attendance.checkIn.done")).toBeInTheDocument();
    expect(queryTextOf("attendance.checkIn.renewNow")).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("[Check in another member] returns to step 1 with an empty search and focus in the field", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.another" }));
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("R2 and R3: a warning with the dates and [Renew now]", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "checked_in_expiring_soon", expiryDate: "2026-11-17" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.okExpiring "))).toBeInTheDocument();
    expect(buttonOf("attendance.checkIn.renewNow")).toBeInTheDocument();
    await user.click(buttonOf("attendance.checkIn.another"));
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "checked_in_grace_period", expiryDate: "2026-11-13", graceEndsOn: "2026-11-16" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.okGrace "))).toBeInTheDocument();
    expect(buttonOf("attendance.checkIn.renewNow")).toBeInTheDocument();
  });

  it("R4: not checked in, role alert, days or the 'today' variant, [Renew now]", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "rejected_expired", daysSinceExpiry: 5, attendanceId: null, checkedInAt: null }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    const text = await screen.findByText((c) => c.startsWith("attendance.checkIn.rejectedExpired "));
    expect(text.textContent).toContain('"days":5');
    expect(text.closest('[role="alert"]')).not.toBeNull();
    expect(textOf("attendance.checkIn.rejectedExpiredHelp")).toBeInTheDocument();
    expect(buttonOf("attendance.checkIn.renewNow")).toBeInTheDocument();
    await user.click(buttonOf("attendance.checkIn.another"));
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "rejected_expired", daysSinceExpiry: 0 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.rejectedExpiredToday "))).toBeInTheDocument();
  });

  it("R5: no paid session with the amount, role alert, [Record payment and check in]", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "session_required", sessionAmount: 2000 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    const text = await screen.findByText((c) => c.startsWith("attendance.checkIn.sessionNeeded "));
    expect(text.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText((c) => c.startsWith("attendance.checkIn.sessionNeededHelp ")).textContent).toContain("2,000");
    expect(buttonOf("attendance.checkIn.recordAndCheckIn")).toBeInTheDocument();
  });

  it("R7: already checked in, role status, nothing else to do", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "already_checked_in", since: "2026-11-15T06:40:00.000Z" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    const text = await screen.findByText((c) => c.startsWith("attendance.checkIn.alreadyIn "));
    expect(text.closest('[role="status"]')).not.toBeNull();
  });

  it.each([
    ["refused_deactivated", "attendance.checkIn.refused.deactivated"],
    ["refused_registration_fee_due", "attendance.checkIn.refused.awaitingFee"],
    ["refused_no_plan", "attendance.checkIn.refused.noPlan"],
  ])("R8: %s is neutral, role alert, with a link to open the member", async (outcome, key) => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: result({ outcome, attendanceId: null, checkedInAt: null }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    const text = await screen.findByText((c) => c.startsWith(`${key} `));
    expect(text.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/members?memberId=${ANGE.id}`);
    expect(buttonOf("attendance.checkIn.another")).toBeInTheDocument();
  });

  it("R9: a suspended gym is a danger alert with only [Done]", async () => {
    const { user, onClose } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValue({ data: null, error: { code: "gym_suspended", message: "suspended" } });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    const text = await screen.findByText("attendance.checkIn.refused.suspendedGym");
    expect(text.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "attendance.checkIn.another" })).toBeNull();
    await user.click(buttonOf("attendance.checkIn.done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("R11: a network failure keeps step 1, the confirm enabled, and the search-again hint", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockRejectedValue(new Error("network"));
    await user.click(buttonOf("attendance.checkIn.confirm"));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText((c) => c.startsWith("attendance.checkIn.network "))).toBeInTheDocument();
    expect(within(alert).getByText((c) => c.startsWith("attendance.checkIn.networkHint "))).toBeInTheDocument();
    expect(buttonOf("attendance.checkIn.confirm")).toBeEnabled();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  it("R11 retry is safe: the second submit answers 'already checked in' (the server's one-open rule)", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockRejectedValueOnce(new Error("network"));
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await screen.findByRole("alert");
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "already_checked_in", since: "2026-11-15T07:02:00.000Z" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.alreadyIn "))).toBeInTheDocument();
  });

  it("R12: offline, the confirm is disabled and the reason is visible beside it", async () => {
    setOnline(false);
    const { user } = setup();
    await openAndChoose(user);
    expect(textOf("attendance.checkIn.offline").closest('[role="status"]')).not.toBeNull();
    expect(buttonOf("attendance.checkIn.confirm")).toBeDisabled();
  });

  it("a double submit reaches the server once", async () => {
    const { user } = setup();
    await openAndChoose(user);
    let release: (value: unknown) => void = () => {};
    staffCheckInAction.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const confirm = buttonOf("attendance.checkIn.confirm");
    await user.dblClick(confirm);
    expect(staffCheckInAction).toHaveBeenCalledTimes(1);
    release({ data: result({}), error: null });
    await screen.findByText((c) => c.startsWith("attendance.checkIn.ok "));
    expect(staffCheckInAction).toHaveBeenCalledTimes(1);
  });

  it("renew then complete: R4, [Renew now], the renewal, then the check-in by itself and R6", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "rejected_expired", daysSinceExpiry: 3 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.renewNow" }));
    const confirmRenewal = await screen.findByRole("button", { name: "renewalPanel.confirmButton" });
    await waitFor(() => expect(confirmRenewal).toBeEnabled());
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(confirmRenewal);
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.renewedDone "))).toBeInTheDocument();
    expect(confirmRenewalAction).toHaveBeenCalledTimes(1);
    expect(staffCheckInAction).toHaveBeenCalledTimes(2);
    expect(staffCheckInAction).toHaveBeenLastCalledWith({ memberId: ANGE.id });
  });

  it("renew then complete, failure variant: R10 (the renewal stands), and the retry repeats only the check-in", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "rejected_expired", daysSinceExpiry: 3 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.renewNow" }));
    const confirmRenewal = await screen.findByRole("button", { name: "renewalPanel.confirmButton" });
    await waitFor(() => expect(confirmRenewal).toBeEnabled());
    staffCheckInAction.mockRejectedValueOnce(new Error("network"));
    await user.click(confirmRenewal);
    const partial = await screen.findByText((c) => c.startsWith("attendance.checkIn.partialRenewal "));
    expect(partial.closest('[role="alert"]')).not.toBeNull();
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.renewedDone "))).toBeInTheDocument();
    expect(confirmRenewalAction).toHaveBeenCalledTimes(1);
  });

  it("pay then complete: R5, the shared payment panel inline, then the check-in by itself and R6", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "session_required", sessionAmount: 2000 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.recordAndCheckIn" }));
    // the panel is inside the modal, not a second dialog
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    const record = await screen.findByRole("button", { name: "sessionPayment.recordButton" });
    await waitFor(() => expect(record).toBeEnabled());
    recordSessionPaymentAction.mockResolvedValue({ data: {}, error: null });
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(record);
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.sessionDone "))).toBeInTheDocument();
    expect(recordSessionPaymentAction).toHaveBeenCalledTimes(1);
    expect(staffCheckInAction).toHaveBeenCalledTimes(2);
  });

  it("R10: the payment stands, the check-in fails, and the retry repeats ONLY the check-in (the payment function is called once)", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "session_required", sessionAmount: 2000 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.recordAndCheckIn" }));
    const record = await screen.findByRole("button", { name: "sessionPayment.recordButton" });
    await waitFor(() => expect(record).toBeEnabled());
    recordSessionPaymentAction.mockResolvedValue({ data: {}, error: null });
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "session_required", sessionAmount: 2000 }), error: null });
    await user.click(record);
    const partial = await screen.findByText((c) => c.startsWith("attendance.checkIn.partialSession "));
    expect(partial.closest('[role="alert"]')).not.toBeNull();
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.sessionDone "))).toBeInTheDocument();
    expect(recordSessionPaymentAction).toHaveBeenCalledTimes(1);
    expect(staffCheckInAction).toHaveBeenCalledTimes(3);
  });

  it("GymOS Support types a fresh code (the bound-action line shows), and it is sent with the member id", async () => {
    const { user } = setup({ role: "support" });
    await openAndChoose(user);
    expect(screen.getByText((c) => c.startsWith("attendance.checkIn.supportAbout "))).toBeInTheDocument();
    expect(buttonOf("attendance.checkIn.confirm")).toBeDisabled();
    await user.type(screen.getByLabelText("supportStepUp.codeLabel"), "123456");
    staffCheckInAction.mockResolvedValue({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await screen.findByText((c) => c.startsWith("attendance.checkIn.ok "));
    expect(staffCheckInAction).toHaveBeenCalledWith({ memberId: ANGE.id, authCode: "123456" });
  });

  it("after renew then complete the modal is not left busy: the close button is enabled", async () => {
    const { user } = setup();
    await openAndChoose(user);
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "rejected_expired", daysSinceExpiry: 3 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.renewNow" }));
    const confirmRenewal = await screen.findByRole("button", { name: "renewalPanel.confirmButton" });
    await waitFor(() => expect(confirmRenewal).toBeEnabled());
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(confirmRenewal);
    await screen.findByText((c) => c.startsWith("attendance.checkIn.renewedDone "));
    expect(screen.getByRole("button", { name: "attendance.checkIn.close" })).toBeEnabled();
  });

  it("support: after a renewal the grant is spent, so it lands on R10 with a code field and does not check in by itself", async () => {
    const { user } = setup({ role: "support" });
    await openAndChoose(user);
    await user.type(screen.getByLabelText("supportStepUp.codeLabel"), "123456");
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "rejected_expired", daysSinceExpiry: 3 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.renewNow" }));
    const confirmRenewal = await screen.findByRole("button", { name: "renewalPanel.confirmButton" });
    await waitFor(() => expect(confirmRenewal).toBeEnabled());
    await user.click(confirmRenewal);
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.partialRenewal "))).toBeInTheDocument();
    expect(staffCheckInAction).toHaveBeenCalledTimes(1);
    expect(buttonOf("attendance.checkIn.confirm")).toBeDisabled();
    await user.type(screen.getByLabelText("supportStepUp.codeLabel"), "654321");
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.renewedDone "))).toBeInTheDocument();
    expect(staffCheckInAction).toHaveBeenCalledTimes(2);
    expect(staffCheckInAction).toHaveBeenLastCalledWith({ memberId: ANGE.id, authCode: "654321" });
  });

  it("support: after a desk payment the same holds (R10 with a code field, no automatic check-in)", async () => {
    const { user } = setup({ role: "support" });
    await openAndChoose(user);
    await user.type(screen.getByLabelText("supportStepUp.codeLabel"), "123456");
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "session_required", sessionAmount: 2000 }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    await user.click(await screen.findByRole("button", { name: "attendance.checkIn.recordAndCheckIn" }));
    const record = await screen.findByRole("button", { name: "sessionPayment.recordButton" });
    await waitFor(() => expect(record).toBeEnabled());
    recordSessionPaymentAction.mockResolvedValue({ data: {}, error: null });
    await user.click(record);
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.partialSession "))).toBeInTheDocument();
    expect(staffCheckInAction).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText("supportStepUp.codeLabel"), "654321");
    staffCheckInAction.mockResolvedValueOnce({ data: result({ outcome: "checked_in" }), error: null });
    await user.click(buttonOf("attendance.checkIn.confirm"));
    expect(await screen.findByText((c) => c.startsWith("attendance.checkIn.sessionDone "))).toBeInTheDocument();
    expect(staffCheckInAction).toHaveBeenLastCalledWith({ memberId: ANGE.id, authCode: "654321" });
    expect(recordSessionPaymentAction).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => setOnline(true));
