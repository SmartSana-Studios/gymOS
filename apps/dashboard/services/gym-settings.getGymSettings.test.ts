/**
 * Story 19.8: `getGymSettings()` selects `charge_guests_per_session` and maps it
 * to `chargeGuestsPerSession`, which alone decides whether the Overview shows
 * the "Guest sessions: XAF 0" line at a charging gym with no session money
 * yet. The page tests mock this service, so this pins the select string and
 * the row-to-camelCase mapping. Mocking shape follows
 * gym-settings.setRegistrationFee.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let gymRow: Record<string, unknown> | null;
const select = vi.fn<(columns: string) => unknown>();
const eq = vi.fn<(column: string, value: string) => unknown>();
const maybeSingle = vi.fn(async () => ({ data: gymRow, error: null }));
const from = vi.fn<(table: string) => { select: typeof select }>(() => ({ select }));
const getClaims = vi.fn(async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from, auth: { getClaims } })),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { getGymSettings } from "./gym-settings";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "Gym",
    logo_url: null,
    primary_color: null,
    timezone: "Africa/Douala",
    default_language: "en",
    country: "CM",
    grace_period_days: 3,
    capacity: null,
    alert_auto_dismiss_minutes: 30,
    checkin_timeout_hours: 4,
    gym_token: "token",
    registration_fee: 0,
    charge_guests_per_session: true,
    loyalty_enabled: false,
    loyalty_guest_threshold: null,
    loyalty_renewal_threshold: null,
    loyalty_reward_days: null,
    ...overrides,
  };
}

describe("getGymSettings", () => {
  beforeEach(() => {
    select.mockReset();
    eq.mockReset();
    from.mockClear();
    select.mockReturnValue({ eq });
    eq.mockReturnValue({ maybeSingle });
  });

  it("selects charge_guests_per_session from gyms", async () => {
    gymRow = baseRow();

    await getGymSettings();

    expect(from).toHaveBeenCalledWith("gyms");
    expect(select.mock.calls[0]?.[0]).toContain("charge_guests_per_session");
    expect(eq).toHaveBeenCalledWith("id", "gym-1");
  });

  it("maps charge_guests_per_session to chargeGuestsPerSession", async () => {
    gymRow = baseRow({ charge_guests_per_session: true });
    const on = await getGymSettings();
    expect(on.data?.chargeGuestsPerSession).toBe(true);

    gymRow = baseRow({ charge_guests_per_session: false });
    const off = await getGymSettings();
    expect(off.data?.chargeGuestsPerSession).toBe(false);
  });

  it("selects the four loyalty columns and maps them, keeping null thresholds null", async () => {
    gymRow = baseRow({
      loyalty_enabled: true,
      loyalty_guest_threshold: 5,
      loyalty_renewal_threshold: 3,
      loyalty_reward_days: 30,
    });
    const on = await getGymSettings();
    const columns = select.mock.calls.at(-1)?.[0] ?? "";
    for (const column of ["loyalty_enabled", "loyalty_guest_threshold", "loyalty_renewal_threshold", "loyalty_reward_days"]) {
      expect(columns).toContain(column);
    }
    expect(on.data).toMatchObject({
      loyaltyEnabled: true,
      loyaltyGuestThreshold: 5,
      loyaltyRenewalThreshold: 3,
      loyaltyRewardDays: 30,
    });

    gymRow = baseRow();
    const off = await getGymSettings();
    expect(off.data).toMatchObject({
      loyaltyEnabled: false,
      loyaltyGuestThreshold: null,
      loyaltyRenewalThreshold: null,
      loyaltyRewardDays: null,
    });
  });
});
