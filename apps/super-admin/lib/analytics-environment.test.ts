import { afterEach, beforeEach, describe, expect, it } from "vitest";

const KEYS = ["APP_ENV", "VERCEL_ENV"] as const;
const saved: Record<string, string | undefined> = {};

describe("resolveAnalyticsEnvironment", () => {
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
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

  it("unset -> dev", async () => {
    const { resolveAnalyticsEnvironment } = await import("./analytics-environment");
    expect(resolveAnalyticsEnvironment()).toBe("dev");
  });

  it("unrecognized value -> dev", async () => {
    process.env.VERCEL_ENV = "some-future-vercel-env";
    const { resolveAnalyticsEnvironment } = await import("./analytics-environment");
    expect(resolveAnalyticsEnvironment()).toBe("dev");
  });

  it("APP_ENV wins over VERCEL_ENV; explicit env objects work", async () => {
    const { resolveAnalyticsEnvironment } = await import("./analytics-environment");
    expect(resolveAnalyticsEnvironment({ APP_ENV: "production", VERCEL_ENV: "preview" })).toBe("prod");
    expect(resolveAnalyticsEnvironment({})).toBe("dev");
  });
});
