/** Story 24-3: server.ts, proxy.ts and client.ts each pass the shared cookieOptions to @supabase/ssr. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ssr = vi.hoisted(() => ({
  server: vi.fn((..._a: unknown[]) => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u" } } }) } })),
  browser: vi.fn((..._a: unknown[]) => ({})),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: ssr.server, createBrowserClient: ssr.browser }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("../utils", () => ({ hasEnvVars: true }));

const optionsOf = (fn: { mock: { calls: unknown[][] } }) => (fn.mock.calls.at(-1)?.[2] as { cookieOptions?: Record<string, unknown> }).cookieOptions;

beforeEach(() => {
  ssr.server.mockClear();
  ssr.browser.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("cookieOptions reach every Supabase client (story 24-3)", () => {
  it("server.ts", async () => {
    const { createClient } = await import("./server");
    await createClient();
    expect(optionsOf(ssr.server)).toMatchObject({ name: "__Host-sb-auth", secure: true });
  });

  it("proxy.ts", async () => {
    const { updateSession } = await import("./proxy");
    await updateSession(new NextRequest("http://localhost:3000/auth/login"));
    expect(optionsOf(ssr.server)).toMatchObject({ name: "__Host-sb-auth", secure: true });
  });

  it("proxy.ts refuses a prefixed cookie over HTTP on a LAN host in dev, but not on localhost", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("AUTH_COOKIE_UNPREFIXED", "");
    const { updateSession } = await import("./proxy");
    await expect(updateSession(new NextRequest("http://192.168.1.5:3000/members"))).rejects.toThrow(/AUTH_COOKIE_UNPREFIXED/);
    await expect(updateSession(new NextRequest("http://localhost:3000/auth/login"))).resolves.toBeDefined();
  });

  it("client.ts", async () => {
    const { createClient } = await import("./client");
    createClient();
    expect(optionsOf(ssr.browser)).toMatchObject({ name: "__Host-sb-auth", secure: true });
  });

  it("client.ts honours NEXT_PUBLIC_AUTH_COOKIE_UNPREFIXED", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_COOKIE_UNPREFIXED", "1");
    const { createClient } = await import("./client");
    createClient();
    expect(optionsOf(ssr.browser)).toMatchObject({ name: "sb-auth" });
  });
});
