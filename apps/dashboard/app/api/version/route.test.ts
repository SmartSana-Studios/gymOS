import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/build-id", () => ({ BUILD_ID: "abc1234" }));

import { GET } from "./route";

describe("GET /api/version", () => {
  it("returns the running build and is never cached", async () => {
    const res = GET();

    expect(await res.json()).toEqual({ version: "abc1234" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
