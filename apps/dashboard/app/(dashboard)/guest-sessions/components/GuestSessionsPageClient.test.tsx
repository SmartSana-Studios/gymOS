/**
 * Story 19.10: AD-22. Tab/period/filter links carry the URL state, group
 * headers come from the rows' window totals, the Refund column and chip, the
 * blocked summary and "(synced ...)" suffix, member deep links, and the
 * forbidden/error/empty states.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));

import { GuestSessionsPageClient } from "./GuestSessionsPageClient";

const base = { tab: "paid" as const, period: "today" as const, page: 1, groupByRecorder: true, refundedAfterUseOnly: false };
const summary = { paid: 3, blocked: 5, blockedMembers: 2, free: 0 };

function paidRow(o: Record<string, unknown>) {
  return {
    paymentId: "p1",
    memberId: "m1",
    memberName: "Amina",
    amount: 5000,
    method: "cash",
    createdAt: "2026-10-12T08:00:00Z",
    consumedAt: null,
    refundState: "none",
    recorderId: "u1",
    recorderName: "Rita",
    recorderKind: "staff",
    groupSessions: 2,
    groupTotal: 8000,
    ...o,
  };
}

function ready(overrides: Record<string, unknown> = {}) {
  return (
    <GuestSessionsPageClient
      {...base}
      state="ready"
      summary={summary}
      total={3}
      paidRows={[]}
      blockedRows={[]}
      freeRows={[]}
      {...(overrides as object)}
    />
  );
}

describe("GuestSessionsPageClient", () => {
  it("shows the permission state and no controls for a forbidden viewer", () => {
    render(<GuestSessionsPageClient {...base} state="forbidden" message="You don't have permission to do that." />);
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have permission to do that.");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows the page error with Refresh", async () => {
    const user = userEvent.setup();
    render(<GuestSessionsPageClient {...base} state="error" message="Couldn't load guest sessions." />);
    await user.click(screen.getByRole("button", { name: "guestSessions.refresh" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("puts tab and period in the URL links and marks the active ones", () => {
    render(ready({ tab: "blocked", period: "month", total: 0 }));
    const tabs = within(screen.getByRole("navigation", { name: "guestSessions.tabs.label" }));
    expect(tabs.getByRole("link", { name: "guestSessions.tabs.paid" })).toHaveAttribute("href", "/guest-sessions?tab=paid&period=month");
    expect(tabs.getByRole("link", { name: "guestSessions.tabs.blocked" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "guestSessions.today" })).toHaveAttribute("href", "/guest-sessions?tab=blocked&period=today");
  });

  it("renders group headers from window totals once per group, with member deep links and refund labels", () => {
    render(
      ready({
        paidRows: [
          paidRow({ paymentId: "p1", refundState: "refunded_after_use" }),
          paidRow({ paymentId: "p2", memberId: "m2", memberName: "Bako" }),
          paidRow({
            paymentId: "p3",
            memberId: "m3",
            memberName: "Cyr",
            recorderId: null,
            recorderName: null,
            recorderKind: "tara",
            method: "mobile_money",
            groupSessions: 1,
            groupTotal: 4000,
          }),
        ],
      }),
    );

    const headers = screen.getAllByRole("columnheader").filter((h) => h.getAttribute("colspan") === "6");
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent("guestSessions.groupHeader|name=Rita,count=2,total=8,000");
    expect(headers[1]).toHaveTextContent("name=guestSessions.recorderTara,count=1,total=4,000");
    expect(screen.getByRole("link", { name: "Amina" })).toHaveAttribute("href", "/members?memberId=m1");
    expect(screen.getByText("guestSessions.refund.refundedAfterUse")).toBeInTheDocument();
    expect(screen.getByText("payments.methods.mobileMoney")).toBeInTheDocument();
  });

  it("has no group headers when grouping is None", () => {
    render(ready({ groupByRecorder: false, paidRows: [paidRow({ groupSessions: null, groupTotal: null })], total: 1 }));
    expect(screen.queryAllByRole("columnheader").filter((h) => h.getAttribute("colspan") === "6")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "guestSessions.groupBy.none" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "guestSessions.groupBy.none" })).toHaveAttribute("href", expect.stringContaining("group=none"));
  });

  it("toggles the Refunded-after-use chip through the URL", () => {
    const { rerender } = render(ready({ paidRows: [paidRow({})], total: 1 }));
    const chip = screen.getByRole("link", { name: "guestSessions.refundedAfterUseOnly" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAttribute("href", expect.stringContaining("refunded=1"));

    rerender(ready({ refundedAfterUseOnly: true, paidRows: [paidRow({})], total: 1 }));
    const pressed = screen.getByRole("link", { name: "guestSessions.refundedAfterUseOnly" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(pressed.getAttribute("href")).not.toContain("refunded=1");
  });

  it("shows the blocked summary and '(synced ...)' only for an offline row", () => {
    render(
      ready({
        tab: "blocked",
        total: 2,
        blockedRows: [
          { id: "a1", memberId: "m1", memberName: "Amina", source: "check_in", className: null, time: "2026-10-12T07:00:00Z", scannedAt: "2026-10-12T07:00:00Z", syncedAt: "2026-10-12T09:00:00Z" },
          { id: "a2", memberId: "m2", memberName: "Bako", source: "class", className: "Spin", time: "2026-10-12T08:00:00Z", scannedAt: null, syncedAt: "2026-10-12T08:00:00Z" },
        ],
      }),
    );
    expect(screen.getByText("guestSessions.blockedSummary|attempts=5,members=2")).toBeInTheDocument();
    expect(screen.getAllByText(/guestSessions\.synced/)).toHaveLength(1);
    expect(screen.getByText("Spin")).toBeInTheDocument();
  });

  it("shows Member, Earned, Use by and Status for free sessions", () => {
    render(
      ready({
        tab: "free",
        total: 1,
        freeRows: [{ id: "s1", memberId: "m1", memberName: "Amina", earnedAt: "2026-10-01T00:00:00Z", usableUntil: "2026-11-30T00:00:00Z", status: "available" }],
      }),
    );
    for (const key of ["member", "earned", "useBy", "status"]) {
      expect(screen.getByRole("columnheader", { name: `guestSessions.columns.${key}` })).toBeInTheDocument();
    }
    expect(screen.getByText("guestSessions.status.available")).toBeInTheDocument();
  });

  it("shows the filtered empty copy when the chip is on and nothing matches", () => {
    render(ready({ tab: "paid", total: 0, refundedAfterUseOnly: true }));
    expect(screen.getByText("guestSessions.empty.paidRefundedAfterUse")).toBeInTheDocument();
    expect(screen.queryByText(/guestSessions\.empty\.paid\|/)).toBeNull();
  });

  it.each(["paid", "blocked", "free"] as const)("shows the %s empty-state copy", (tab) => {
    render(ready({ tab, total: 0 }));
    expect(screen.getByText(new RegExp(`guestSessions\\.empty\\.${tab}`))).toBeInTheDocument();
  });

  it("pages at 50 with Previous/Next links that keep the filters", () => {
    render(ready({ page: 2, total: 120, groupByRecorder: false, paidRows: [paidRow({ groupSessions: null, groupTotal: null })] }));
    expect(screen.getByText(/guestSessions\.pagination\.range\|from=51,to=100,total=120/)).toBeInTheDocument();
    const next = screen.getByRole("link", { name: "guestSessions.pagination.next" });
    expect(next.getAttribute("href")).toContain("page=3");
    expect(next.getAttribute("href")).toContain("group=none");
    expect(screen.getByRole("link", { name: "guestSessions.pagination.previous" }).getAttribute("href")).not.toContain("page=");
  });
});
