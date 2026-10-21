import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));

import { resolveActorNames } from "./actorNames";

function client(rpcResult: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) builder[m] = () => builder;
  builder.in = async () => ({ data: [{ user_id: "u1", name: "Staff Sam" }], error: null });
  return { from: () => builder, rpc: async () => rpcResult } as never;
}

describe("resolveActorNames when the proxy lookup fails", () => {
  it("returns the names resolved so far and no error", async () => {
    const result = await resolveActorNames(client({ data: null, error: { message: "boom" } }), "gym-a", ["u1", "proxy"]);
    expect(result.error).toBeNull();
    expect(result.data?.get("u1")).toBe("Staff Sam");
    expect(result.data?.has("proxy")).toBe(false);
  });
});
