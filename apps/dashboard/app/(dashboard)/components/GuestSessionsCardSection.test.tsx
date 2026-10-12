/**
 * Story 19.10: the server section reads today's figures and seeds the client
 * card; a failed read becomes initialFailed, never a throw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const getGuestSessionsSummary = vi.fn();
vi.mock("@/services/guestSessions", () => ({
  getGuestSessionsSummary: (...args: unknown[]) => getGuestSessionsSummary(...args),
}));
vi.mock("./GuestSessionsCard", () => ({
  GuestSessionsCard: function GuestSessionsCard() {
    return null;
  },
}));

import { GuestSessionsCardSection } from "./GuestSessionsCardSection";

const summary = { paid: 1, blocked: 2, blockedMembers: 1, free: 0 };

describe("GuestSessionsCardSection", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getGuestSessionsSummary.mockReset();
  });

  it("reads today and passes the figures", async () => {
    getGuestSessionsSummary.mockResolvedValue({ data: summary, error: null });
    const el = (await GuestSessionsCardSection()) as ReactElement<Record<string, unknown>>;
    expect(getGuestSessionsSummary).toHaveBeenCalledWith("today");
    expect(el.props.initialSummary).toEqual(summary);
    expect(el.props.initialFailed).toBe(false);
  });

  it("passes a failure as initialFailed with no summary", async () => {
    getGuestSessionsSummary.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    const el = (await GuestSessionsCardSection()) as ReactElement<Record<string, unknown>>;
    expect(el.props.initialSummary).toBeNull();
    expect(el.props.initialFailed).toBe(true);
  });
});
