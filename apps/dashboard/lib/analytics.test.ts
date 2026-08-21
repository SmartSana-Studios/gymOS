/**
 * Story 9.5 (Review finding): direct coverage for captureServerEvent()'s
 * real implementation -- previously only exercised via a module mock in
 * services/staff.createStaffMember.test.ts, so its own try/catch and
 * early-return-without-apiKey branches were never actually run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureMock = vi.fn();
const flushMock = vi.fn(async () => undefined);

vi.mock("posthog-node", () => ({
  PostHog: vi.fn().mockImplementation(function () {
    return { capture: captureMock, flush: flushMock };
  }),
}));

const ORIGINAL_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const ORIGINAL_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

describe("captureServerEvent", () => {
  beforeEach(() => {
    vi.resetModules();
    captureMock.mockReset();
    flushMock.mockReset().mockResolvedValue(undefined);
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_KEY = ORIGINAL_KEY;
    }
    if (ORIGINAL_HOST === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_HOST = ORIGINAL_HOST;
    }
  });

  it("no API key configured -> no-op, never constructs a client", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { captureServerEvent } = await import("./analytics");

    await expect(captureServerEvent("staff_created", { gymId: "g1", role: "coach", isExistingAccount: false })).resolves.toBeUndefined();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("captures with the resolved environment tag and flushes before returning", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
    process.env.VERCEL_ENV = "production";
    const { captureServerEvent } = await import("./analytics");

    await captureServerEvent("staff_created", { gymId: "g1", role: "coach", isExistingAccount: false }, "user-1");

    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "staff_created",
      properties: { gymId: "g1", role: "coach", isExistingAccount: false, environment: "prod" },
    });
    expect(flushMock).toHaveBeenCalledTimes(1);
  });

  it("distinctId defaults to 'server' when omitted", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
    const { captureServerEvent } = await import("./analytics");

    await captureServerEvent("app_opened", { gymId: null });

    expect(captureMock).toHaveBeenCalledWith(expect.objectContaining({ distinctId: "server" }));
  });

  it("a capture()/flush() failure never throws (non-blocking discipline)", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
    flushMock.mockRejectedValue(new Error("network error"));
    const { captureServerEvent } = await import("./analytics");

    await expect(captureServerEvent("app_opened", { gymId: null })).resolves.toBeUndefined();
  });
});
