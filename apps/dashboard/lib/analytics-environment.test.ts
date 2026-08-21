/**
 * Story 9.5 (Review finding): direct coverage for resolveAnalyticsEnvironment()
 * -- new-from-scratch env-tagging logic (Dev Notes "The Sentry Pattern This
 * AC Points To Does Not Exist Yet") previously only exercised indirectly via
 * mocked callers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = process.env.VERCEL_ENV;

describe("resolveAnalyticsEnvironment", () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = ORIGINAL_ENV;
    }
  });

  it("production -> prod", async () => {
    process.env.VERCEL_ENV = "production";
    const { resolveAnalyticsEnvironment } = await import("./analytics-environment");

    expect(resolveAnalyticsEnvironment()).toBe("prod");
  });

  it("preview -> staging", async () => {
    process.env.VERCEL_ENV = "preview";
    const { resolveAnalyticsEnvironment } = await import("./analytics-environment");

    expect(resolveAnalyticsEnvironment()).toBe("staging");
  });

  it("unset (local dev) -> dev", async () => {
    const { resolveAnalyticsEnvironment } = await import("./analytics-environment");

    expect(resolveAnalyticsEnvironment()).toBe("dev");
  });

  it("any other/unrecognized value -> dev", async () => {
    process.env.VERCEL_ENV = "some-future-vercel-env";
    const { resolveAnalyticsEnvironment } = await import("./analytics-environment");

    expect(resolveAnalyticsEnvironment()).toBe("dev");
  });
});
