/** Story 23-6c: recordMfaFailureAction reports the lock, and a failure to count is never a lock. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordSupportCodeFailure = vi.fn();
vi.mock("@/services/support-stepup", () => ({ recordSupportCodeFailure: () => recordSupportCodeFailure() }));

beforeEach(() => {
  recordSupportCodeFailure.mockReset();
});

describe("recordMfaFailureAction", () => {
  it("returns locked:true when the service says the threshold was reached", async () => {
    recordSupportCodeFailure.mockResolvedValue(true);
    const { recordMfaFailureAction } = await import("./actions");
    expect(await recordMfaFailureAction()).toEqual({ locked: true });
  });

  it("returns locked:false when the service throws", async () => {
    recordSupportCodeFailure.mockImplementation(async () => {
      throw new Error("boom");
    });
    const { recordMfaFailureAction } = await import("./actions");
    expect(await recordMfaFailureAction()).toEqual({ locked: false });
  });
});
