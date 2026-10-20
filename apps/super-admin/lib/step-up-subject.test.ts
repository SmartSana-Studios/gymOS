import { describe, expect, it } from "vitest";

import { normalizeStepUpSubject } from "./step-up-subject";

describe("normalizeStepUpSubject", () => {
  it("trims and lowercases (the contract both the issue and the consume side rely on)", () => {
    expect(normalizeStepUpSubject("  New@Example.COM \n")).toBe("new@example.com");
  });
  it("is idempotent", () => {
    const once = normalizeStepUpSubject(" A@B.C ");
    expect(normalizeStepUpSubject(once)).toBe(once);
  });
  it("leaves inner characters alone (a factor id or the fixed recovery subject is unchanged)", () => {
    expect(normalizeStepUpSubject("recovery")).toBe("recovery");
    expect(normalizeStepUpSubject("3f2a9c10-1111-4222-8333-444455556666")).toBe("3f2a9c10-1111-4222-8333-444455556666");
  });
});
