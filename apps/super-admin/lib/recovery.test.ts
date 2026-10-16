/** Story 22.8: code and token generation, and the cancel-link origin. */
import { describe, expect, it } from "vitest";

import { appBaseUrl, cancelUrl, generateCancelToken, generateRecoveryCode } from "./recovery";

describe("recovery helpers", () => {
  it("generates 6-digit codes, zero padded", () => {
    for (let i = 0; i < 200; i++) expect(generateRecoveryCode()).toMatch(/^\d{6}$/);
  });
  it("generates distinct 256-bit url-safe tokens", () => {
    const a = generateCancelToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateCancelToken()).not.toBe(a);
  });
  it("takes the origin from configuration only, trimmed", () => {
    expect(appBaseUrl({ SUPER_ADMIN_APP_URL: " https://admin.example.com/ " })).toBe("https://admin.example.com");
  });
  it("falls back to localhost outside production and refuses in production", () => {
    expect(appBaseUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(appBaseUrl({ NODE_ENV: "production" })).toBeNull();
  });
  it("builds an encoded cancel link", () => {
    expect(cancelUrl("https://a.b", "x/y z")).toBe("https://a.b/auth/recovery/cancel?token=x%2Fy%20z");
  });
});
