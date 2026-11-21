/**
 * Story 29.4 (UX AD-14 in picker mode): the chosen coach's assigned members, read-only. Every row link keeps ?coach=, the list has the note-snippet column,
 * a member without a subscription renders without a status badge, and the empty state names the coach.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/coach",
  useSearchParams: () => new URLSearchParams("coach=11111111-1111-4111-8111-111111111111"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
    i18n: { language: "en" },
  }),
}));

import { CoachPortalPageClient, type PortalMemberRow } from "./CoachPortalPageClient";

const COACH = "11111111-1111-4111-8111-111111111111";
const PICKER = { coachId: COACH, coachName: "Coach A" };

const ROWS: PortalMemberRow[] = [
  { memberId: "m-alice", memberName: "Alice", planName: "Premium", status: "active", expiryDate: "2099-06-30", lastNoteSnippet: "Second note" },
  { memberId: "m-bob", memberName: "Bob", planName: null, status: null, expiryDate: null, lastNoteSnippet: null },
];

describe("CoachPortalPageClient in picker mode", () => {
  beforeEach(() => push.mockReset());

  it("shows the plan name, the status badge when there is one, and the last-note column", () => {
    render(<CoachPortalPageClient members={ROWS} search="" sort="name" dir="asc" picker={PICKER} />);

    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Second note")).toBeInTheDocument();
    expect(screen.getByText("coach.picker.table.lastNote")).toBeInTheDocument();
    expect(screen.getAllByText("members.status.active")).toHaveLength(1);
  });

  it.each([["row click"], ["Enter on a row"], ["the View button"]])("opening a member keeps ?coach= (%s)", (how) => {
    render(<CoachPortalPageClient members={ROWS} search="" sort="name" dir="asc" picker={PICKER} />);

    const row = screen.getAllByRole("link")[0];
    if (how === "row click") fireEvent.click(row);
    else if (how === "Enter on a row") fireEvent.keyDown(row, { key: "Enter" });
    else fireEvent.click(screen.getAllByRole("button", { name: /coachPortal.actions.view/ })[0]);

    expect(push).toHaveBeenCalledWith(`/coach/m-alice?coach=${COACH}`);
  });

  it("sorting keeps ?coach= in the address", () => {
    render(<CoachPortalPageClient members={ROWS} search="" sort="name" dir="asc" picker={PICKER} />);

    fireEvent.click(screen.getByRole("button", { name: "coachPortal.table.plan" }));

    expect(push).toHaveBeenCalledWith(`/coach?coach=${COACH}&sort=plan&dir=asc`);
  });

  it("the empty state names the coach, and the Coach's own guidance is not used", () => {
    render(<CoachPortalPageClient members={[]} search="" sort="name" dir="asc" picker={PICKER} />);

    expect(screen.getByText('coach.picker.noMembers|{"name":"Coach A"}')).toBeInTheDocument();
    expect(screen.queryByText("coachPortal.emptyNoAssignments")).toBeNull();
  });

  it("without picker the Coach's own list is unchanged: no note column, plain member links", () => {
    render(
      <CoachPortalPageClient
        members={[{ memberId: "m-x", memberName: "Xavier", planName: "Monthly", planType: "monthly", status: "active", expiryDate: "2099-01-01" }]}
        search=""
        sort="name"
        dir="asc"
      />,
    );

    expect(screen.queryByText("coach.picker.table.lastNote")).toBeNull();
    fireEvent.click(screen.getAllByRole("link")[0]);
    expect(push).toHaveBeenCalledWith("/coach/m-x");
  });
});
