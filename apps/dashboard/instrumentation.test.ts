/** Story 24-3: register() refuses to start when the unprefixed-cookie dev gate is set in production. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

describe("register()", () => {
  it("rejects with AUTH_COOKIE_UNPREFIXED set in production", async () => {
    vi.stubEnv("AUTH_COOKIE_UNPREFIXED", "1");
    vi.stubEnv("APP_ENV", "production");
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow(/AUTH_COOKIE_UNPREFIXED/);
  });

  it("resolves without the gate", async () => {
    vi.stubEnv("AUTH_COOKIE_UNPREFIXED", "");
    vi.stubEnv("APP_ENV", "production");
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });
});
