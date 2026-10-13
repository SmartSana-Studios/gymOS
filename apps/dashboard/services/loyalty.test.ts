/**
 * Story 20.5: `getMemberLoyalty` reads only `effective_loyalty()`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc, from })),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

import { getMemberLoyalty, parseEffectiveLoyalty } from "./loyalty";

const PAYLOAD = {
  enabled: true,
  guest_stamps: 3,
  subscriber_stamps: 1,
  guest_threshold: 5,
  renewal_threshold: 3,
  reward_days: 30,
  guest_window_days: 90,
  subscriber_window_days: 90,
  free_sessions: [{ id: "f1", usable_until: "2026-12-01T00:00:00Z" }],
  paid_sessions: [{ id: "p1", usable_until: "2026-10-18T00:00:00Z" }],
};

describe("getMemberLoyalty", () => {
  beforeEach(() => {
    rpc.mockClear();
    from.mockClear();
  });

  it("calls effective_loyalty only and parses the payload", async () => {
    rpcResult = { data: PAYLOAD, error: null };
    await expect(getMemberLoyalty("m1")).resolves.toEqual({
      data: {
        enabled: true,
        guestStamps: 3,
        subscriberStamps: 1,
        guestThreshold: 5,
        renewalThreshold: 3,
        freeSessions: [{ id: "f1", usableUntil: "2026-12-01T00:00:00Z" }],
      },
      error: null,
    });
    expect(rpc.mock.calls[0]).toEqual(["effective_loyalty", { p_member_id: "m1" }]);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns null data for JSON null (suspended gym)", async () => {
    rpcResult = { data: null, error: null };
    await expect(getMemberLoyalty("m1")).resolves.toEqual({ data: null, error: null });
  });

  it("returns a mapped error on failure", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(getMemberLoyalty("m1")).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});

describe("parseEffectiveLoyalty", () => {
  it("is null for non-objects and a missing switch", () => {
    expect(parseEffectiveLoyalty(null)).toBeNull();
    expect(parseEffectiveLoyalty("x")).toBeNull();
    expect(parseEffectiveLoyalty([])).toBeNull();
    expect(parseEffectiveLoyalty({})).toBeNull();
  });

  it("tolerates null thresholds and malformed free-session entries", () => {
    expect(
      parseEffectiveLoyalty({ enabled: false, guest_threshold: null, free_sessions: [null, { id: 1 }] }),
    ).toEqual({
      enabled: false,
      guestStamps: 0,
      subscriberStamps: 0,
      guestThreshold: null,
      renewalThreshold: null,
      freeSessions: [],
    });
  });
});
