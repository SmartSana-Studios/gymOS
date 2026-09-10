/**
 * Story 17.3 (AC #7, #8): the Coach Portal sub-nav lights the right surface
 * from `useSelectedLayoutSegment()`, and says so to assistive tech with
 * `aria-current="page"`. The member-detail case is the one worth pinning:
 * `/coach/[memberId]` returns the member's UUID as the segment, and My
 * Members must stay lit there with no hardcoded list of sibling routes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let segment: string | null = null;

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => segment,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { CoachPortalNav, CoachPortalNavFallback } from "./CoachPortalNav";

const MEMBER_ID = "3f2b8c1e-5d4a-4e7b-9c1d-2a6f8e0b7d35";

describe("CoachPortalNav", () => {
  beforeEach(() => {
    segment = null;
  });

  it("offers Overview, My Members and My Classes, in that order", () => {
    render(<CoachPortalNav />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["coachPortal.subNav.overview", "/coach/overview"],
      ["coachPortal.subNav.myMembers", "/coach"],
      ["coachPortal.subNav.myClasses", "/coach/classes"],
    ]);
  });

  it("labels its landmark, so it is distinguishable from the sidebar's <nav>", () => {
    render(<CoachPortalNav />);

    expect(screen.getByRole("navigation", { name: "coachPortal.subNav.label" })).toBeInTheDocument();
  });

  it.each([
    [null, "coachPortal.subNav.myMembers"],
    ["overview", "coachPortal.subNav.overview"],
    ["classes", "coachPortal.subNav.myClasses"],
    [MEMBER_ID, "coachPortal.subNav.myMembers"],
  ])("segment %j marks %s as the current page, and only it", (value, expected) => {
    segment = value;
    render(<CoachPortalNav />);

    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([expected]);
  });

  it("renders a text-free placeholder row while the segment is unresolved", () => {
    const { container } = render(<CoachPortalNavFallback />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild?.children).toHaveLength(3);
  });
});
