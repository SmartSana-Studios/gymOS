/**
 * Story 19.10: getGuestSessionsSummaryAction parses the client-supplied period.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getGuestSessionsSummary = vi.fn();
vi.mock("@/services/guestSessions", () => ({
  getGuestSessionsSummary: (...args: unknown[]) => getGuestSessionsSummary(...args),
}));
vi.mock("@/services/session", () => ({
  updateLanguagePreference: vi.fn(),
  switchActiveGym: vi.fn(),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })),
}));

import { getGuestSessionsSummaryAction } from "./actions";

describe("getGuestSessionsSummaryAction", () => {
  beforeEach(() => {
    getGuestSessionsSummary.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it.each([
    ["month", "month"],
    ["today", "today"],
    ["junk", "today"],
    [42, "today"],
    [null, "today"],
    [undefined, "today"],
  ])("maps %j to %s", async (input, expected) => {
    await getGuestSessionsSummaryAction(input);
    expect(getGuestSessionsSummary).toHaveBeenCalledWith(expected);
  });
});
