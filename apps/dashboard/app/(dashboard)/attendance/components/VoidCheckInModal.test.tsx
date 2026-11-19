/**
 * Story 27.3, UX AD-11 V1.8: the Void modal. Focus opens on [Keep check-in], Escape is disabled, the conditional lines only when the server
 * reported a session or a stamp, the reason limits (5 to 300, counter), each refusal inline with role alert and [Close] (the later-visit
 * line adds "Void the later check-in first" only for a staff later visit), a network failure keeps [Void check-in] enabled, and GymOS
 * Support types a fresh code first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const voidStaffCheckInAction = vi.fn();
vi.mock("../actions", () => ({ voidStaffCheckInAction: (...args: unknown[]) => voidStaffCheckInAction(...args) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));

import { VoidCheckInModal, type VoidTarget } from "./VoidCheckInModal";

const TARGET: VoidTarget = {
  attendanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  memberName: "Ange T.",
  checkedInAt: "2026-11-15T07:02:00.000Z",
  consumedSession: false,
  earnedStamp: false,
};

function outcome(o: string, extra: Record<string, unknown> = {}) {
  return { data: { outcome: o, attendanceId: TARGET.attendanceId, voidedAt: null, sessionReleased: false, stampRemoved: false, laterIsStaffEntry: false, ...extra }, error: null };
}

function setup(props: { target?: Partial<VoidTarget>; isSupport?: boolean } = {}) {
  const onClose = vi.fn();
  const onVoided = vi.fn();
  const onStale = vi.fn();
  const user = userEvent.setup();
  render(<VoidCheckInModal target={{ ...TARGET, ...props.target }} isSupport={props.isSupport} onClose={onClose} onVoided={onVoided} onStale={onStale} />);
  return { user, onClose, onVoided, onStale };
}

const voidButton = () => screen.getByRole("button", { name: "attendance.void.confirm" });

describe("VoidCheckInModal (AD-11 V1.8)", () => {
  beforeEach(() => {
    voidStaffCheckInAction.mockReset();
  });

  it("opens on [Keep check-in] and ignores Escape", () => {
    setup();
    expect(screen.getByRole("button", { name: "attendance.void.keep" })).toHaveFocus();
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("shows the explanation, and the conditional lines only when they apply", () => {
    setup();
    expect(screen.getByText((c) => c.startsWith("attendance.void.body "))).toBeInTheDocument();
    expect(screen.queryByText((c) => c.startsWith("attendance.void.sessionBack"))).toBeNull();
    expect(screen.queryByText("attendance.void.paymentStays")).toBeNull();
    expect(screen.queryByText("attendance.void.stampRemoved")).toBeNull();
  });

  it("shows the session and payment lines, and the stamp line, when the server reported them", () => {
    setup({ target: { consumedSession: true, earnedStamp: true } });
    expect(screen.getByText((c) => c.startsWith("attendance.void.sessionBack "))).toBeInTheDocument();
    expect(screen.getByText("attendance.void.paymentStays")).toBeInTheDocument();
    expect(screen.getByText("attendance.void.stampRemoved")).toBeInTheDocument();
  });

  it("needs a reason of 5 to 300 characters and counts them", async () => {
    const { user } = setup();
    expect(voidButton()).toBeDisabled();
    const box = screen.getByRole("textbox");
    await user.type(box, "abcd");
    expect(voidButton()).toBeDisabled();
    expect(screen.getByText((c) => c.startsWith("attendance.void.reason.count ")).textContent).toContain('"count":4');
    await user.type(box, "e");
    expect(voidButton()).toBeEnabled();
    await user.clear(box);
    await user.type(box, "    ab    ");
    expect(voidButton()).toBeDisabled();
    expect(box).toHaveAttribute("maxlength", "300");
  });

  it("voids with the trimmed reason and tells the page", async () => {
    const { user, onVoided } = setup();
    voidStaffCheckInAction.mockResolvedValue(outcome("voided"));
    await user.type(screen.getByRole("textbox"), "  wrong member selected  ");
    await user.click(voidButton());
    await waitFor(() => expect(onVoided).toHaveBeenCalledTimes(1));
    expect(voidStaffCheckInAction).toHaveBeenCalledWith({ attendanceId: TARGET.attendanceId, reason: "wrong member selected" });
  });

  it("refuses a later visit that relies on the session, with the extra line only for a staff later visit", async () => {
    const { user } = setup();
    voidStaffCheckInAction.mockResolvedValue(outcome("later_visit_relies", { laterIsStaffEntry: false }));
    await user.type(screen.getByRole("textbox"), "wrong member selected");
    await user.click(voidButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("attendance.void.refused.laterVisit");
    expect(alert).not.toHaveTextContent("attendance.void.refused.laterVisitStaff");
    expect(screen.getByRole("button", { name: "common.close" })).toBeInTheDocument();
  });

  it("adds 'Void the later check-in first' when the later visit was a staff entry", async () => {
    const { user } = setup();
    voidStaffCheckInAction.mockResolvedValue(outcome("later_visit_relies", { laterIsStaffEntry: true }));
    await user.type(screen.getByRole("textbox"), "wrong member selected");
    await user.click(voidButton());
    expect(await screen.findByText("attendance.void.refused.laterVisitStaff")).toBeInTheDocument();
  });

  it.each([
    ["not_same_day", "attendance.void.refused.notToday", false],
    ["already_voided", "attendance.void.refused.already", true],
    ["not_staff_entry", "attendance.void.refused.notStaff", false],
    ["attendance_not_found", "attendance.void.refused.notFound", true],
  ])("%s is an inline alert with [Close]; the list refreshes only for already voided", async (code, key, stale) => {
    const { user, onStale, onVoided } = setup();
    voidStaffCheckInAction.mockResolvedValue(outcome(code));
    await user.type(screen.getByRole("textbox"), "wrong member selected");
    await user.click(voidButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(key);
    expect(screen.getByRole("button", { name: "common.close" })).toBeInTheDocument();
    expect(onStale).toHaveBeenCalledTimes(stale ? 1 : 0);
    expect(onVoided).not.toHaveBeenCalled();
  });

  it("the server rejecting the reason keeps the modal open with the reason error and no refusal", async () => {
    const { user, onVoided, onStale } = setup();
    voidStaffCheckInAction.mockResolvedValue(outcome("invalid_reason"));
    await user.type(screen.getByRole("textbox"), "wrong member selected");
    await user.click(voidButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("attendance.void.reason.error");
    expect(voidButton()).toBeInTheDocument();
    expect(onVoided).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
  });

  it("a free (loyalty) session is worded as free and has no payment line; a paid one keeps both", () => {
    setup({ target: { consumedSession: true, consumedSessionPaid: false } });
    expect(screen.getByText((c) => c.startsWith("attendance.void.sessionBackFree "))).toBeInTheDocument();
    expect(screen.queryByText("attendance.void.paymentStays")).toBeNull();
  });

  it("a paid session is worded as paid with the payment line", () => {
    setup({ target: { consumedSession: true, consumedSessionPaid: true } });
    expect(screen.getByText((c) => c.startsWith("attendance.void.sessionBack "))).toBeInTheDocument();
    expect(screen.queryByText((c) => c.startsWith("attendance.void.sessionBackFree"))).toBeNull();
    expect(screen.getByText("attendance.void.paymentStays")).toBeInTheDocument();
  });

  it("keeps [Void check-in] enabled after a network failure", async () => {
    const { user } = setup();
    voidStaffCheckInAction.mockRejectedValue(new Error("network"));
    await user.type(screen.getByRole("textbox"), "wrong member selected");
    await user.click(voidButton());
    expect(await screen.findByText("attendance.void.network")).toBeInTheDocument();
    expect(voidButton()).toBeEnabled();
  });

  it("GymOS Support types a code, shown with the bound-action line, and it is sent", async () => {
    const { user, onVoided } = setup({ isSupport: true });
    expect(screen.getByText((c) => c.startsWith("attendance.void.supportAbout "))).toBeInTheDocument();
    voidStaffCheckInAction.mockResolvedValue(outcome("voided"));
    await user.type(screen.getByLabelText(/attendance\.void\.reason\.label/), "wrong member selected");
    expect(voidButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("supportStepUp.codeLabel"), { target: { value: "654321" } });
    await user.click(voidButton());
    await waitFor(() => expect(onVoided).toHaveBeenCalled());
    expect(voidStaffCheckInAction).toHaveBeenCalledWith({ attendanceId: TARGET.attendanceId, reason: "wrong member selected", authCode: "654321" });
  });
});
