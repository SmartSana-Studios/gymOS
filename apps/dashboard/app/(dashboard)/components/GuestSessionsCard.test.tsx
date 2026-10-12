/**
 * Story 19.10: the Overview Guest sessions card. Figures and their links,
 * the period radiogroup and its localStorage memory, the in-card error with
 * Retry, and the zero case (figures, not an empty state).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getGuestSessionsSummaryAction = vi.fn();
vi.mock("../actions", () => ({
  getGuestSessionsSummaryAction: (...args: unknown[]) => getGuestSessionsSummaryAction(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));

import { GuestSessionsCard, GUEST_SESSIONS_PERIOD_STORAGE_KEY } from "./GuestSessionsCard";

const summary = { paid: 3, blocked: 2, blockedMembers: 1, free: 0 };

beforeEach(() => {
  getGuestSessionsSummaryAction.mockReset();
  window.localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GuestSessionsCard", () => {
  it("shows the three figures as links to the matching tab and period, with full-meaning labels", () => {
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);

    const paid = screen.getByRole("link", { name: /paidAria/ });
    expect(paid).toHaveAttribute("href", "/guest-sessions?tab=paid&period=today");
    expect(paid).toHaveTextContent("3");
    expect(paid).toHaveAccessibleName("overview.cards.guestSessionsCard.paidAria|period=overview.cards.guestSessionsCard.periodToday,count=3");

    const blocked = screen.getByRole("link", { name: /blockedAria/ });
    expect(blocked).toHaveAttribute("href", "/guest-sessions?tab=blocked&period=today");
    expect(blocked).toHaveTextContent("overview.cards.guestSessionsCard.blockedMembers|count=1");

    expect(screen.getByRole("link", { name: /freeAria/ })).toHaveAttribute(
      "href",
      "/guest-sessions?tab=free&period=today",
    );
  });

  it("shows zeros as figures, not an empty state", () => {
    render(<GuestSessionsCard initialSummary={{ paid: 0, blocked: 0, blockedMembers: 0, free: 0 }} initialFailed={false} />);
    expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switches period, refetches, relinks and remembers the choice", async () => {
    getGuestSessionsSummaryAction.mockResolvedValue({
      data: { paid: 9, blocked: 4, blockedMembers: 3, free: 1 },
      error: null,
    });
    const user = userEvent.setup();
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);

    const month = screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.month" });
    await user.click(month);

    await waitFor(() => expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("9"));
    expect(getGuestSessionsSummaryAction).toHaveBeenCalledWith("month");
    expect(screen.getByRole("link", { name: /paidAria/ })).toHaveAttribute("href", "/guest-sessions?tab=paid&period=month");
    expect(month).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(GUEST_SESSIONS_PERIOD_STORAGE_KEY)).toBe("month");
  });

  it("applies a remembered period on mount and fetches it", async () => {
    window.localStorage.setItem(GUEST_SESSIONS_PERIOD_STORAGE_KEY, "month");
    getGuestSessionsSummaryAction.mockResolvedValue({ data: { paid: 7, blocked: 0, blockedMembers: 0, free: 0 }, error: null });
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);

    await waitFor(() => expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("7"));
    expect(getGuestSessionsSummaryAction).toHaveBeenCalledWith("month");
    expect(screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.month" })).toHaveAttribute("aria-checked", "true");
  });

  it("falls back to today when the stored value is junk and does not refetch", () => {
    window.localStorage.setItem(GUEST_SESSIONS_PERIOD_STORAGE_KEY, "week");
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);
    expect(getGuestSessionsSummaryAction).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.today" })).toHaveAttribute("aria-checked", "true");
  });

  it("still works when localStorage throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    getGuestSessionsSummaryAction.mockResolvedValue({ data: summary, error: null });
    const user = userEvent.setup();
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);
    await user.click(screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.month" }));
    await waitFor(() => expect(getGuestSessionsSummaryAction).toHaveBeenCalled());
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("shows the error with Retry inside the card, and Retry reloads the figures", async () => {
    getGuestSessionsSummaryAction.mockResolvedValue({ data: summary, error: null });
    const user = userEvent.setup();
    render(<GuestSessionsCard initialSummary={null} initialFailed />);

    expect(screen.getByRole("alert")).toHaveTextContent("overview.cards.guestSessionsCard.loadError");
    await user.click(screen.getByRole("button", { name: "overview.cards.guestSessionsCard.retry" }));

    await waitFor(() => expect(screen.getByRole("link", { name: /paidAria/ })).toBeInTheDocument());
    expect(getGuestSessionsSummaryAction).toHaveBeenCalledWith("today");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error when a refetch fails, keeping the period control usable", async () => {
    getGuestSessionsSummaryAction.mockResolvedValue({ data: null, error: { code: "unknown", message: "m" } });
    const user = userEvent.setup();
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);
    await user.click(screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.month" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });
});

describe("GuestSessionsCard (review fixes)", () => {
  it("adopts fresh server props while Today is showing", () => {
    const { rerender } = render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);
    expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("3");

    rerender(<GuestSessionsCard initialSummary={{ ...summary, paid: 8 }} initialFailed={false} />);
    expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("8");

    rerender(<GuestSessionsCard initialSummary={null} initialFailed />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not clobber a fetched Month view when props change", async () => {
    getGuestSessionsSummaryAction.mockResolvedValue({ data: { paid: 9, blocked: 0, blockedMembers: 0, free: 0 }, error: null });
    const user = userEvent.setup();
    const { rerender } = render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);
    await user.click(screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.month" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("9"));

    rerender(<GuestSessionsCard initialSummary={{ ...summary, paid: 50 }} initialFailed={false} />);
    expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("9");
  });

  it("moves selection and focus with arrow keys and keeps one tab stop", async () => {
    getGuestSessionsSummaryAction.mockResolvedValue({ data: summary, error: null });
    const user = userEvent.setup();
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);
    const today = screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.today" });
    const month = screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.month" });
    expect(today).toHaveAttribute("tabindex", "0");
    expect(month).toHaveAttribute("tabindex", "-1");

    today.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(month).toHaveAttribute("aria-checked", "true"));
    expect(month).toHaveFocus();
    expect(month).toHaveAttribute("tabindex", "0");
    expect(today).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(today).toHaveAttribute("aria-checked", "true"));
    expect(today).toHaveFocus();
  });

  it("keeps the latest period's figures when an earlier request resolves last", async () => {
    window.localStorage.setItem(GUEST_SESSIONS_PERIOD_STORAGE_KEY, "month");
    let resolveMonth!: (v: unknown) => void;
    let resolveToday!: (v: unknown) => void;
    getGuestSessionsSummaryAction
      .mockImplementationOnce(() => new Promise((r) => (resolveMonth = r)))
      .mockImplementationOnce(() => new Promise((r) => (resolveToday = r)));
    const user = userEvent.setup();
    render(<GuestSessionsCard initialSummary={summary} initialFailed={false} />);
    await waitFor(() => expect(getGuestSessionsSummaryAction).toHaveBeenCalledWith("month"));

    await user.click(screen.getByRole("radio", { name: "overview.cards.guestSessionsCard.today" }));
    await waitFor(() => expect(getGuestSessionsSummaryAction).toHaveBeenCalledWith("today"));

    resolveToday({ data: { paid: 4, blocked: 0, blockedMembers: 0, free: 0 }, error: null });
    await waitFor(() => expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("4"));
    resolveMonth({ data: { paid: 99, blocked: 0, blockedMembers: 0, free: 0 }, error: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole("link", { name: /paidAria/ })).toHaveTextContent("4");
  });
});
