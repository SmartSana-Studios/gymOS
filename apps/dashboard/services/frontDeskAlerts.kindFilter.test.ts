/**
 * Story 19.6b (0111): the front-desk alert readers show subscription-status
 * alerts only. A `session_required` row has a null status and must never
 * render as an at-risk alert.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let alertsResult: { data: unknown; error: unknown };

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "single"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([`${table}.${method}`, ...args]);
      return builder;
    };
  }
  const result = () =>
    table === "gyms" ? { data: { alert_auto_dismiss_minutes: 30 }, error: null } : alertsResult;
  builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return builder;
}

const from = vi.fn((table: string) => makeBuilder(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null })) },
    from,
  })),
}));
const realtimeHandlers: Array<(payload: { new: unknown }) => void> = [];
const channelStub = {
  on: vi.fn((_type: string, _filter: unknown, cb: (payload: { new: unknown }) => void) => {
    realtimeHandlers.push(cb);
    return channelStub;
  }),
  subscribe: vi.fn(() => channelStub),
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ from, channel: vi.fn(() => channelStub) })),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listActiveFrontDeskAlerts } from "./frontDeskAlerts";
import {
  fetchActiveFrontDeskAlerts,
  isSubscriptionStatusAlertRow,
  subscribeToFrontDeskAlerts,
} from "@/lib/realtime/frontDeskAlerts";

beforeEach(() => {
  calls = [];
  alertsResult = { data: [], error: null };
});

describe("front-desk alert readers filter on kind", () => {
  it("listActiveFrontDeskAlerts reads only subscription_status rows", async () => {
    await listActiveFrontDeskAlerts();
    expect(calls).toContainEqual(["front_desk_alerts.eq", "kind", "subscription_status"]);
  });

  it("fetchActiveFrontDeskAlerts (polling path) reads only subscription_status rows", async () => {
    await fetchActiveFrontDeskAlerts("gym-1");
    expect(calls).toContainEqual(["front_desk_alerts.eq", "kind", "subscription_status"]);
  });
});

describe("isSubscriptionStatusAlertRow", () => {
  it("accepts subscription_status and kind-less rows, rejects session_required", () => {
    expect(isSubscriptionStatusAlertRow({ kind: "subscription_status" })).toBe(true);
    expect(isSubscriptionStatusAlertRow({})).toBe(true);
    expect(isSubscriptionStatusAlertRow({ kind: "session_required" })).toBe(false);
  });
});

describe("subscribeToFrontDeskAlerts", () => {
  it("drops session_required payloads on INSERT and UPDATE and forwards subscription_status ones", () => {
    realtimeHandlers.length = 0;
    const onInsertOrUpdate = vi.fn();
    subscribeToFrontDeskAlerts("gym-1", onInsertOrUpdate, vi.fn());

    expect(realtimeHandlers).toHaveLength(2); // INSERT, UPDATE
    const sessionRow = { id: "a1", member_id: "m1", kind: "session_required", status: null, dismissed_at: null };
    const statusRow = { id: "a2", member_id: "m2", kind: "subscription_status", status: "expired", dismissed_at: null };

    for (const handler of realtimeHandlers) {
      onInsertOrUpdate.mockClear();
      handler({ new: sessionRow });
      expect(onInsertOrUpdate).not.toHaveBeenCalled();
      handler({ new: statusRow });
      expect(onInsertOrUpdate).toHaveBeenCalledWith(statusRow);
    }
  });
});
