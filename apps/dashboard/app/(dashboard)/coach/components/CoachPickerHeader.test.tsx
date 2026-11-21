/**
 * Story 29.4 (UX AD-32): the picker's select and banner, and the Classes / Members sub-navigation.
 *  - the select lists the active coaches it is given, is carried as ?coach=, shows nothing chosen for an unknown id (it "clears");
 *  - nothing chosen: the select takes focus; a coach chosen: the banner, neutral, `role="status"` once, not dismissible;
 *  - choosing from /coach goes to Classes; on a member page goes to that coach's Members; elsewhere keeps the page and other parameters, drops `tab`;
 *  - the nav is Classes then Members only, keeps ?coach=, lights the right one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

let pathname = "/coach";
let query = "";
let segment: string | null = null;
const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(query),
  useSelectedLayoutSegment: () => segment,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
    i18n: { language: "en" },
  }),
}));

import { CoachPickerHeader, CoachPickerHeaderFallback } from "./CoachPickerHeader";
import { CoachPickerNav } from "./CoachPickerNav";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const COACHES = [
  { id: A, name: "Coach A" },
  { id: B, name: "Coach B" },
];

describe("CoachPickerHeader", () => {
  beforeEach(() => {
    pathname = "/coach";
    query = "";
    segment = null;
    push.mockReset();
  });

  it("lists the active coaches under the label, and nothing is chosen by default", () => {
    render(<CoachPickerHeader coaches={COACHES} />);

    const select = screen.getByLabelText("coach.picker.label") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["coach.picker.label", "Coach A", "Coach B"]);
    expect(select.value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("focuses the select when nothing is chosen, and does not when a coach is", () => {
    const { unmount } = render(<CoachPickerHeader coaches={COACHES} />);
    expect(screen.getByLabelText("coach.picker.label")).toHaveFocus();
    unmount();

    query = `coach=${A}`;
    render(<CoachPickerHeader coaches={COACHES} />);
    expect(screen.getByLabelText("coach.picker.label")).not.toHaveFocus();
  });

  it("shows the chosen coach selected, with one neutral non-dismissible read-only banner naming them", () => {
    query = `coach=${B}`;
    render(<CoachPickerHeader coaches={COACHES} />);

    expect((screen.getByLabelText("coach.picker.label") as HTMLSelectElement).value).toBe(B);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toBe('coach.picker.banner|{"name":"Coach B"}');
    expect(banners[0].className).not.toMatch(/blue|info/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an id that is not in the list clears the select and shows no banner", () => {
    query = "coach=44444444-4444-4444-8444-444444444444";
    render(<CoachPickerHeader coaches={COACHES} />);

    expect((screen.getByLabelText("coach.picker.label") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("choosing from /coach with nothing chosen goes to Classes", () => {
    render(<CoachPickerHeader coaches={COACHES} />);

    fireEvent.change(screen.getByLabelText("coach.picker.label"), { target: { value: A } });

    expect(push).toHaveBeenCalledWith(`/coach/classes?coach=${A}`);
  });

  it("choosing on Classes keeps the tab and the other parameters, and drops tab", () => {
    pathname = "/coach/classes";
    query = `coach=${A}&tab=workout-plan&x=1`;
    render(<CoachPickerHeader coaches={COACHES} />);

    fireEvent.change(screen.getByLabelText("coach.picker.label"), { target: { value: B } });

    expect(push).toHaveBeenCalledWith(`/coach/classes?coach=${B}&x=1`);
  });

  it("choosing on Members (/coach with a coach) keeps Members", () => {
    pathname = "/coach";
    query = `coach=${A}&sort=plan`;
    render(<CoachPickerHeader coaches={COACHES} />);

    fireEvent.change(screen.getByLabelText("coach.picker.label"), { target: { value: B } });

    expect(push).toHaveBeenCalledWith(`/coach?coach=${B}&sort=plan`);
  });

  it("choosing on a member page goes to the new coach's Members tab", () => {
    pathname = "/coach/33333333-3333-4333-8333-333333333333";
    query = `coach=${A}`;
    render(<CoachPickerHeader coaches={COACHES} />);

    fireEvent.change(screen.getByLabelText("coach.picker.label"), { target: { value: B } });

    expect(push).toHaveBeenCalledWith(`/coach?coach=${B}`);
  });

  it("renders nothing when the gym has no coach", () => {
    const { container } = render(<CoachPickerHeader coaches={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("has a text-free fallback", () => {
    const { container } = render(<CoachPickerHeaderFallback />);
    expect(container.textContent).toBe("");
  });
});

describe("CoachPickerNav", () => {
  beforeEach(() => {
    query = `coach=${A}`;
    segment = null;
  });

  it("offers Classes then Members only, each keeping ?coach=, and no Overview", () => {
    render(<CoachPickerNav />);

    expect(screen.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["coach.picker.tab.classes", `/coach/classes?coach=${A}`],
      ["coach.picker.tab.members", `/coach?coach=${A}`],
    ]);
    expect(screen.getByRole("navigation", { name: "coachPortal.subNav.label" })).toBeInTheDocument();
  });

  it("carries no query when no coach is chosen", () => {
    query = "";
    render(<CoachPickerNav />);

    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/coach/classes", "/coach"]);
  });

  it.each([
    ["classes", ["coach.picker.tab.classes"]],
    [null, ["coach.picker.tab.members"]],
    ["33333333-3333-4333-8333-333333333333", ["coach.picker.tab.members"]],
    ["overview", []],
  ])("segment %j lights %j", (value, expected) => {
    segment = value;
    render(<CoachPickerNav />);

    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(expected);
  });
});
