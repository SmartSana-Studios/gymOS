/**
 * Story 17.1 (AC #15): the shared AD-02 stat tile. Presentational only --
 * `value` arrives pre-formatted, so these tests assert it is rendered
 * verbatim (no reformatting), that the whole tile is the link, and that the
 * alert tone is opt-in (Story 17.2's "At risk" card is its only user).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renders the label and the pre-formatted value verbatim", () => {
    render(<StatCard label="Revenue this month" value="XAF -1,500" href="/payments" />);

    expect(screen.getByText("Revenue this month")).toBeInTheDocument();
    expect(screen.getByText("XAF -1,500")).toBeInTheDocument();
  });

  it("wraps the whole tile in a single link to href", () => {
    render(<StatCard label="Expiring this week" value="4" href="/subscriptions?status=expiring_soon" />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/subscriptions?status=expiring_soon");
    expect(links[0]).toContainElement(screen.getByText("Expiring this week"));
    expect(links[0]).toContainElement(screen.getByText("4"));
  });

  it("uses the default tone unless alert is asked for", () => {
    render(<StatCard label="Checked in now" value="12" href="/attendance" />);

    expect(screen.getByText("12")).not.toHaveClass("text-destructive");
  });

  it("renders the value in the alert colour when tone is alert", () => {
    render(<StatCard label="At risk" value="3" href="/subscriptions" tone="alert" />);

    expect(screen.getByText("3")).toHaveClass("text-destructive");
  });
});
