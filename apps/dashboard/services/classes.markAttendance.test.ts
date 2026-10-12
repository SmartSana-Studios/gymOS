/**
 * Story 19.7 (0112): `markAttendance()` maps the RPC's three outcomes.
 *  - a row with attended_at set is a success;
 *  - a row with attended_at null (the session-required refusal, which commits
 *    its attempt and alert instead of raising) is an AppError `session_required`;
 *  - the all-null composite PostgREST sends for the expired-member null return
 *    stays `rejected: true`, and a thrown RPC error stays a mapped error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcResult = { data: Record<string, unknown> | null; error: unknown };
let rpcResult: RpcResult;
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<RpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

import { markAttendance } from "./classes";

const BOOKING = { id: "b-1", gym_id: "g-1", class_session_id: "s-1", member_id: "m-1", created_at: "2026-10-11T08:00:00Z" };

describe("markAttendance", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("passes the booking id and reports an attended row", async () => {
    rpcResult = { data: { ...BOOKING, attended_at: "2026-10-11T09:00:00Z" }, error: null };

    const res = await markAttendance("b-1");

    expect(rpc).toHaveBeenCalledWith("mark_class_attendance", { p_booking_id: "b-1" });
    expect(res).toEqual({
      data: { id: "b-1", memberId: "m-1", memberName: "", attended: true },
      rejected: false,
      error: null,
    });
  });

  it("maps a returned row with attended_at null to a session_required AppError", async () => {
    rpcResult = { data: { ...BOOKING, attended_at: null }, error: null };

    const res = await markAttendance("b-1");

    expect(res.data).toBeNull();
    expect(res.rejected).toBe(false);
    expect(res.error?.code).toBe("session_required");
  });

  it("keeps the all-null composite (expired member) as rejected", async () => {
    rpcResult = {
      data: { id: null, gym_id: null, class_session_id: null, member_id: null, created_at: null, attended_at: null },
      error: null,
    };

    const res = await markAttendance("b-1");

    expect(res).toEqual({ data: null, rejected: true, error: null });
  });

  it("maps an RPC error", async () => {
    rpcResult = { data: null, error: { message: "boom" } };

    const res = await markAttendance("b-1");

    expect(res.data).toBeNull();
    expect(res.rejected).toBe(false);
    expect(res.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});
