import { describe, expect, it } from "vitest";

import { dashboardBaseUrl, generateSupportInviteToken, isSupportEmail, supportInviteLink, supportInviteMail } from "./support-invite";

describe("support invite token and link", () => {
  it("is '<uuid>.<64 hex>' and different every time", () => {
    const a = generateSupportInviteToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/);
    expect(generateSupportInviteToken()).not.toBe(a);
  });

  it("builds the link from the configured origin only", () => {
    expect(dashboardBaseUrl({ DASHBOARD_APP_URL: "https://owner.gymosapps.com" })).toBe("https://owner.gymosapps.com");
    expect(dashboardBaseUrl({})).toBeNull();
    expect(dashboardBaseUrl({ DASHBOARD_APP_URL: "https://owner.gymosapps.com/path" })).toBeNull();
    expect(dashboardBaseUrl({ DASHBOARD_APP_URL: "http://owner.gymosapps.com", NODE_ENV: "production" })).toBeNull();
    expect(dashboardBaseUrl({ DASHBOARD_APP_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
    expect(supportInviteLink("https://owner.gymosapps.com", "t.k")).toBe("https://owner.gymosapps.com/support-invite?t=t.k");
  });

  it("accepts only @gymosapps.com addresses", () => {
    expect(isSupportEmail(" Sup@GymOSApps.com ")).toBe(true);
    for (const bad of ["a@x.example", "a@gymosapps.com.evil.io", "a@@gymosapps.com", "@gymosapps.com", "a b@gymosapps.com"]) {
      expect(isSupportEmail(bad)).toBe(false);
    }
  });

  it("the mail carries the link and nothing else secret, in both languages", () => {
    for (const locale of ["en", "fr"] as const) {
      const m = supportInviteMail({ link: "https://x.test/support-invite?t=abc", locale });
      expect(m.text).toContain("https://x.test/support-invite?t=abc");
      expect(m.text.toLowerCase()).not.toMatch(/password: |mot de passe temporaire/);
    }
  });
});
