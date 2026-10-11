/**
 * Story 19.9b: the panel readers also return session_required alerts (SSR and
 * the polling path), enriched with class / offline / in-flight context, merged
 * newest first with the subscription alerts. The kind filter on the
 * subscription read is unchanged (frontDeskAlerts.kindFilter.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let subscriptionRows: unknown[];
let sessionRows: unknown[];
let attemptRows: unknown[];
let paymentRows: unknown[];

function makeBuilder(table: string) {
  const state: { kind?: unknown } = {};
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "single"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([`${table}.${method}`, ...args]);
      if (method === "eq" && args[0] === "kind") state.kind = args[1];
      return builder;
    };
  }
  const result = () => {
    if (table === "gyms") return { data: { alert_auto_dismiss_minutes: 30 }, error: null };
    if (table === "session_attempts") return { data: attemptRows, error: null };
    if (table === "payments") return { data: paymentRows, error: null };
    return {
      data: state.kind === "session_required" ? sessionRows : subscriptionRows,
      error: null,
    };
  };
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
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ from, channel: vi.fn() })),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listActiveFrontDeskAlerts } from "./frontDeskAlerts";
import { fetchActiveFrontDeskAlerts, isSessionRequiredAlertRow } from "@/lib/realtime/frontDeskAlerts";

beforeEach(() => {
  calls = [];
  subscriptionRows = [
    {
      id: "a-sub",
      member_id: "m-sub",
      status: "expired",
      expiry_date: "2026-10-01",
      created_at: "2026-10-11T08:00:00Z",
      members: { name: "Bob", photo_url: null },
    },
  ];
  sessionRows = [
    {
      id: "a-ses",
      member_id: "m-ses",
      status: null,
      expiry_date: null,
      created_at: "2026-10-11T09:00:00Z",
      members: { name: "Alice", photo_url: null },
    },
  ];
  attemptRows = [
    {
      member_id: "m-ses",
      scanned_at: "2026-10-11T08:59:59Z",
      created_at: "2026-10-11T09:00:00Z",
      class_session_id: "cs-1",
      class_sessions: { classes: { name: "HIIT" } },
    },
  ];
  paymentRows = [{ member_id: "m-ses" }];
});

describe("front-desk alert readers include session_required alerts for the panel", () => {
  it("SSR reader returns both kinds, newest first, with session context", async () => {
    const result = await listActiveFrontDeskAlerts();

    expect(result.error).toBeNull();
    expect(calls).toContainEqual(["front_desk_alerts.eq", "kind", "session_required"]);
    expect(calls).toContainEqual(["front_desk_alerts.eq", "kind", "subscription_status"]);
    const alerts = result.data?.alerts ?? [];
    expect(alerts.map((a) => [a.id, a.kind, a.status])).toEqual([
      ["a-ses", "session_required", null],
      ["a-sub", "subscription_status", "expired"],
    ]);
    expect(alerts[0]).toMatchObject({ className: "HIIT", scannedOfflineAt: null, paymentInFlight: true });
  });

  it("polling reader returns both kinds too", async () => {
    const alerts = await fetchActiveFrontDeskAlerts("gym-1");

    expect(alerts.map((a) => a.id)).toEqual(["a-ses", "a-sub"]);
    expect(alerts[0]).toMatchObject({ kind: "session_required", className: "HIIT", paymentInFlight: true });
  });

  it("session rows are recognised by the realtime predicate", () => {
    expect(isSessionRequiredAlertRow({ kind: "session_required" })).toBe(true);
    expect(isSessionRequiredAlertRow({ kind: "subscription_status" })).toBe(false);
    expect(isSessionRequiredAlertRow({})).toBe(false);
  });
});
