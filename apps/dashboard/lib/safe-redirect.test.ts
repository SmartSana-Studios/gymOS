import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\r/evil.com"],
    ["/\n/evil.com"],
    ["/ok\u0000"],
    ["/ok\u007f"],
    ["https://evil.com"],
    ["evil.com"],
    [""],
    [null],
    [undefined],
  ])("falls back to / for %j", (value) => {
    expect(safeRedirectPath(value as string | null | undefined)).toBe("/");
  });

  it("keeps a plain path with a query string", () => {
    expect(safeRedirectPath("/members?filter=expiring&page=2")).toBe("/members?filter=expiring&page=2");
    expect(safeRedirectPath("/")).toBe("/");
  });
});
