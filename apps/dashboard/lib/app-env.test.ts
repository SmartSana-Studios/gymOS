import { afterEach, beforeEach, describe, expect, it } from "vitest";

const KEYS = ["APP_ENV", "VERCEL_ENV", "GIT_SHA", "VERCEL_GIT_COMMIT_SHA"] as const;
const saved: Record<string, string | undefined> = {};

describe("app-env", () => {
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

  it("APP_ENV wins over VERCEL_ENV", async () => {
    process.env.APP_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    const { appEnvironment } = await import("./app-env");
    expect(appEnvironment()).toBe("production");
  });

  it("falls back to VERCEL_ENV when APP_ENV is unset", async () => {
    process.env.VERCEL_ENV = "preview";
    const { appEnvironment } = await import("./app-env");
    expect(appEnvironment()).toBe("preview");
  });

  it("neither set, or an unknown value, is development", async () => {
    const { appEnvironment } = await import("./app-env");
    expect(appEnvironment()).toBe("development");
    process.env.APP_ENV = "foo";
    process.env.VERCEL_ENV = "bar";
    expect(appEnvironment()).toBe("development");
  });

  it("takes an explicit env object", async () => {
    const { appEnvironment, buildId } = await import("./app-env");
    expect(appEnvironment({ APP_ENV: "preview" })).toBe("preview");
    expect(buildId({ GIT_SHA: "abc" })).toBe("abc");
  });

  it("buildId prefers GIT_SHA over VERCEL_GIT_COMMIT_SHA, and defaults to dev", async () => {
    const { buildId } = await import("./app-env");
    expect(buildId()).toBe("dev");
    process.env.VERCEL_GIT_COMMIT_SHA = "vercelsha";
    expect(buildId()).toBe("vercelsha");
    process.env.GIT_SHA = "gitsha";
    expect(buildId()).toBe("gitsha");
  });

  it("trims and lower-cases APP_ENV; blank or padded values behave", async () => {
    const { appEnvironment, buildId } = await import("./app-env");
    expect(appEnvironment({ APP_ENV: " Production\n" })).toBe("production");
    expect(appEnvironment({ APP_ENV: "  ", VERCEL_ENV: "preview" })).toBe("preview");
    expect(buildId({ GIT_SHA: "  ", VERCEL_GIT_COMMIT_SHA: "v1\n" })).toBe("v1");
    expect(buildId({ GIT_SHA: "abc\n" })).toBe("abc");
    expect(buildId({ GIT_SHA: "\n", VERCEL_GIT_COMMIT_SHA: " " })).toBe("dev");
  });
});
