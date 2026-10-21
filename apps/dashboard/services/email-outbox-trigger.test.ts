/** Story 23.9: the dashboard only nudges the Super Admin app; it never holds a mail key. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { nudgeEmailOutbox } from "./email-outbox-trigger";

afterEach(() => vi.unstubAllGlobals());

describe("nudgeEmailOutbox", () => {
  it("does nothing without both settings", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await nudgeEmailOutbox({ SUPER_ADMIN_APP_URL: "https://portal.example" })).toBe(false);
    expect(await nudgeEmailOutbox({ EMAIL_DRAIN_SECRET: "s" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the drain route with the bearer secret", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await nudgeEmailOutbox({ SUPER_ADMIN_APP_URL: "https://portal.example/", EMAIL_DRAIN_SECRET: "s3cret" })).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://portal.example/api/email-outbox/drain");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
  });

  it("never throws when the call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await nudgeEmailOutbox({ SUPER_ADMIN_APP_URL: "https://portal.example", EMAIL_DRAIN_SECRET: "s" })).toBe(false);
  });
});
