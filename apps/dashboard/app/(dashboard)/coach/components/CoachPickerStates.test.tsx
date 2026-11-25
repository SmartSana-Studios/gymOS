/**
 * Story 29.4 (UX AD-32): the picker's messages. Each is the server returning nothing, in words; none reveals more.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
    i18n: { language: "en" },
  }),
}));

import { CoachPickerNotice } from "./CoachPickerStates";

const A = "11111111-1111-4111-8111-111111111111";

describe("CoachPickerNotice", () => {
  it("choose: the one line, no link", () => {
    render(<CoachPickerNotice state={{ kind: "choose" }} />);
    expect(screen.getByText("coach.picker.choose")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("no coaches, Owner or Supervisor: the line and an [Open Staff] link to Staff", () => {
    render(<CoachPickerNotice state={{ kind: "no-coaches", canOpenStaff: true }} />);
    expect(screen.getByText("coach.picker.noCoaches")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "coach.picker.openStaff" })).toHaveAttribute("href", "/settings/staff");
  });

  it("no coaches, Manager: the Manager line and no link (a Manager cannot reach Staff)", () => {
    render(<CoachPickerNotice state={{ kind: "no-coaches", canOpenStaff: false }} />);
    expect(screen.getByText("coach.picker.noCoachesManager")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("unavailable and inactive", () => {
    const { unmount } = render(<CoachPickerNotice state={{ kind: "unavailable" }} />);
    expect(screen.getByText("coach.picker.unavailable")).toBeInTheDocument();
    unmount();
    render(<CoachPickerNotice state={{ kind: "inactive", name: "Coach Gone" }} />);
    expect(screen.getByText('coach.picker.inactive|{"name":"Coach Gone"}')).toBeInTheDocument();
  });

  it("partUnavailable: one status message with links to Classes and Members keeping the coach, and no other content", () => {
    render(<CoachPickerNotice state={{ kind: "partUnavailable", coachId: A }} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("coach.picker.partUnavailable");
    expect(screen.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["coach.picker.tab.classes", `/coach/classes?coach=${A}`],
      ["coach.picker.tab.members", `/coach?coach=${A}`],
    ]);
  });

  it("partUnavailable without a coach links to the bare tabs", () => {
    render(<CoachPickerNotice state={{ kind: "partUnavailable", coachId: null }} />);
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/coach/classes", "/coach"]);
  });

  it("notAssigned: names neither the member nor anything of the profile, and offers [Back to members] for that coach", () => {
    render(<CoachPickerNotice state={{ kind: "notAssigned", coachId: A, coachName: "Coach A" }} />);

    expect(screen.getByText('coach.picker.notAssigned|{"member":"coach.picker.thisMember","coach":"Coach A"}')).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "coach.picker.backToMembers" })).toHaveAttribute("href", `/coach?coach=${A}`);
  });
});
