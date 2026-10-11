/**
 * Story 19.7: a refused class attendance (no paid session) leaves the row
 * unmarked, keeps the action enabled, and shows an inline role="alert"
 * message. No payment button here (the panel arrives in 19.9).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ClassRow, SessionBookingRow } from "@/services/classes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

type MarkResult = {
  data: SessionBookingRow | null;
  rejected: boolean;
  error: { code: string; message: string } | null;
};
const markAttendanceAction = vi.fn<(id: string) => Promise<MarkResult>>();
const getSessionBookingsAction = vi.fn<(id: string) => Promise<{ data: SessionBookingRow[]; error: null }>>();
vi.mock("../actions", () => ({
  markAttendanceAction: (id: string) => markAttendanceAction(id),
  getSessionBookingsAction: (id: string) => getSessionBookingsAction(id),
}));
vi.mock("./ClassModal", () => ({ ClassModal: () => null }));

import { ClassesPageClient } from "./ClassesPageClient";

const CLASS: ClassRow = {
  id: "c-1",
  name: "HIIT",
  description: null,
  coachId: "coach-1",
  coachName: "Coach",
  capacity: 10,
  scheduleType: "one_off",
  oneOffSessionAt: "2026-10-12T10:00:00Z",
  recurrenceDays: null,
  recurrenceTime: null,
  recurrenceStartDate: null,
  nextSessionAt: "2026-10-12T10:00:00Z",
  nextSessionId: "s-1",
  bookedCount: 1,
} as ClassRow;

async function expandAndGetButton() {
  const user = userEvent.setup();
  render(<ClassesPageClient initialClasses={[CLASS]} coaches={[]} role="receptionist" />);
  await user.click(screen.getByText("HIIT"));
  const button = await screen.findByRole("button", { name: "classes.attendance.markAttended" });
  return { user, button };
}

describe("ClassesPageClient session-required refusal", () => {
  beforeEach(() => {
    markAttendanceAction.mockReset();
    getSessionBookingsAction.mockReset();
    getSessionBookingsAction.mockResolvedValue({
      data: [{ id: "b-1", memberId: "m-1", memberName: "Alice", attended: false }],
      error: null,
    });
  });

  it("shows the inline message, keeps the row unmarked and the action enabled", async () => {
    markAttendanceAction.mockResolvedValue({
      data: null,
      rejected: false,
      error: { code: "session_required", message: "No paid session" },
    });
    const { user, button } = await expandAndGetButton();

    await user.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("classes.attendance.sessionRequired");
    expect(screen.queryByText("classes.attendance.attended")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "classes.attendance.markAttended" })).toBeEnabled();
  });

  it("clears the message and marks the row when a retry succeeds", async () => {
    markAttendanceAction.mockResolvedValueOnce({
      data: null,
      rejected: false,
      error: { code: "session_required", message: "No paid session" },
    });
    markAttendanceAction.mockResolvedValueOnce({
      data: { id: "b-1", memberId: "m-1", memberName: "", attended: true },
      rejected: false,
      error: null,
    });
    const { user, button } = await expandAndGetButton();

    await user.click(button);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "classes.attendance.markAttended" }));

    expect(await screen.findByText("classes.attendance.attended")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
