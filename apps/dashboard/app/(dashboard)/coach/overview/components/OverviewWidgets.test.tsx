/**
 * Story 17.5 (AC #10, #15): AD-20's presentational widget pieces, rendered.
 *
 *  - OverviewWidget: an `h2` title, an optional description and header link;
 *  - CaseloadList: its error, empty and list states; every row a link; `meta`
 *    only when present; the "+N more" line only when there is one;
 *  - MembersAtAGlance: the total, its label and one badge per status, or its
 *    error.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { CaseloadList, type CaseloadListRow } from "./CaseloadList";
import { MembersAtAGlance } from "./MembersAtAGlance";
import { OverviewWidget } from "./OverviewWidget";

const ROWS: CaseloadListRow[] = [
  { key: "s-1", href: "/coach/classes#class-c-yoga", primary: "Thu, Sep 10, 18:00", secondary: "Morning Yoga", meta: "11/15 booked" },
  { key: "m-marc", href: "/coach/m-marc", primary: "Marc", secondary: "No note yet" },
];

describe("OverviewWidget", () => {
  it("renders its title as a level-2 heading, with its description, link and body", () => {
    render(
      <OverviewWidget title="Needs Follow-Up" description="No note in 14 days" link={{ href: "/coach", label: "All →" }}>
        <p>{"body"}</p>
      </OverviewWidget>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Needs Follow-Up" })).toBeInTheDocument();
    expect(screen.getByText("No note in 14 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All →" })).toHaveAttribute("href", "/coach");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders neither a description nor a link when none is given", () => {
    const { container } = render(
      <OverviewWidget title="Recent">
        <p>{"body"}</p>
      </OverviewWidget>,
    );

    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("CaseloadList", () => {
  it("renders every row as a link, with meta only where a row has one", () => {
    render(<CaseloadList state="ready" errorLabel="error" emptyLabel="empty" rows={ROWS} moreLabel={null} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/coach/classes#class-c-yoga", "/coach/m-marc"]);
    expect(within(links[0]).getByText("Thu, Sep 10, 18:00")).toBeInTheDocument();
    expect(within(links[0]).getByText("Morning Yoga")).toBeInTheDocument();
    expect(within(links[0]).getByText("11/15 booked")).toBeInTheDocument();
    expect(within(links[1]).getByText("Marc")).toBeInTheDocument();
    expect(within(links[1]).getByText("No note yet")).toBeInTheDocument();
    expect(links[1].querySelectorAll("span.shrink-0")).toHaveLength(0);
    expect(screen.queryByText("empty")).toBeNull();
  });

  it("shows the more line only when there is one", () => {
    const { rerender } = render(<CaseloadList state="ready" errorLabel="error" emptyLabel="empty" rows={ROWS} moreLabel="+2 more" />);
    expect(screen.getByText("+2 more")).toBeInTheDocument();

    rerender(<CaseloadList state="ready" errorLabel="error" emptyLabel="empty" rows={ROWS} moreLabel={null} />);
    expect(screen.queryByText("+2 more")).toBeNull();
  });

  it("shows the empty label, and no list, when there are no rows", () => {
    const { container } = render(<CaseloadList state="ready" errorLabel="error" emptyLabel="Nothing here" rows={[]} moreLabel={null} />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(container.querySelectorAll("ul, a")).toHaveLength(0);
  });

  it("shows only the error label in its error state", () => {
    const { container } = render(<CaseloadList state="error" errorLabel="Load failed" emptyLabel="empty" rows={ROWS} moreLabel="+2 more" />);

    expect(screen.getByText("Load failed")).toHaveClass("text-red-600");
    expect(container.querySelectorAll("ul, a")).toHaveLength(0);
    expect(screen.queryByText("+2 more")).toBeNull();
  });
});

describe("MembersAtAGlance", () => {
  it("renders the total, its label and one badge per status in the order given", () => {
    render(
      <MembersAtAGlance
        state="ready"
        errorLabel="error"
        total="12"
        assignedLabel="Assigned members"
        items={[
          { status: "active", label: "Active", count: "9" },
          { status: "expired", label: "Expired", count: "3" },
        ]}
      />,
    );

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Assigned members")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Active9", "Expired3"]);
  });

  it("shows only the error label in its error state", () => {
    render(<MembersAtAGlance state="error" errorLabel="Load failed" total="0" assignedLabel="Assigned members" items={[]} />);

    expect(screen.getByText("Load failed")).toHaveClass("text-red-600");
    expect(screen.queryByText("Assigned members")).toBeNull();
  });
});
