import { describe, expect, it } from "vitest";
import { isReservedLabel } from "@gymos/types";

describe("isReservedLabel", () => {
  it("matches case-insensitively, by prefix, and by list entry", () => {
    expect(isReservedLabel("WWW")).toBe(true);
    expect(isReservedLabel("gymos-demo")).toBe(true);
    expect(isReservedLabel("mail")).toBe(true);
    expect(isReservedLabel("shop")).toBe(false);
  });
});
