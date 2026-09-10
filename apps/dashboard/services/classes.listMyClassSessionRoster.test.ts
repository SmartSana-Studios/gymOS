/**
 * Story 17.4 (Task 3, AC #7): `listMyClassSessionRoster()` is a thin wrapper
 * over the `list_my_class_session_roster()` RPC (0096). The RPC decides whose
 * roster a caller may read (supabase/tests/coach_portal_my_classes.test.sql);
 * this pins the service contract -- the session id is passed as the RPC's
 * only argument, the three roster columns are mapped snake -> camel with a
 * not-yet-attended booking kept as `attendedAt: null`, an empty or null
 * result is an empty roster, and a failure is a mapped `{ data: null, error }`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { member_id: string; member_name: string; attended_at: string | null };

let rpcResult: { data: Row[] | null; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
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

import { listMyClassSessionRoster } from "./classes";

describe("listMyClassSessionRoster", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("passes the session id as the RPC's only argument", async () => {
    rpcResult = { data: [], error: null };

    await listMyClassSessionRoster("session-1");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["list_my_class_session_roster", { p_class_session_id: "session-1" }]);
  });

  it("maps each booking to camelCase, keeping a not-yet-attended booking as null", async () => {
    rpcResult = {
      data: [
        { member_id: "m-alice", member_name: "Alice Member", attended_at: "2026-09-10T17:05:00+00:00" },
        { member_id: "m-bob", member_name: "Bob Member", attended_at: null },
      ],
      error: null,
    };

    await expect(listMyClassSessionRoster("session-1")).resolves.toEqual({
      data: [
        { memberId: "m-alice", memberName: "Alice Member", attendedAt: "2026-09-10T17:05:00+00:00" },
        { memberId: "m-bob", memberName: "Bob Member", attendedAt: null },
      ],
      error: null,
    });
  });

  it("returns an empty roster for a null result", async () => {
    rpcResult = { data: null, error: null };

    await expect(listMyClassSessionRoster("session-1")).resolves.toEqual({ data: [], error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    rpcResult = { data: null, error: { message: "invalid input syntax for type uuid" } };

    await expect(listMyClassSessionRoster("not-a-uuid")).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
