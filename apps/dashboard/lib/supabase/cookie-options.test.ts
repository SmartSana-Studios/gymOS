/**
 * Story 24-3 (AD-44, NFR-026): every staff session cookie this app issues or removes carries the `__Host-` prefix, `Path=/`,
 * `Secure`, `SameSite=Lax` and no `Domain`. Uses the real @supabase/ssr (only `fetch` is stubbed) so a change to the options or
 * to the helper's chunking fails here, including an oversized multi-chunk session.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import {
  assertNoUnprefixedInProduction,
  assertPrefixedCookieCanStick,
  authCookieOptions,
  hasCurrentSessionCookie,
  legacyCookieNames,
} from "./cookie-options";

type Issued = { name: string; value: string; options: Record<string, unknown> };

function session(bytes: number) {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const user = {
    id: "u1",
    aud: "authenticated",
    role: "authenticated",
    email: "a@b.c",
    app_metadata: {},
    user_metadata: { pad: "x".repeat(bytes) },
    created_at: "2026-01-01T00:00:00Z",
  };
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", exp: 4102444800, aud: "authenticated", role: "authenticated" })}.sig`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4102444800,
    refresh_token: "r",
    user,
  };
}

async function drive(bytes: number, opts = authCookieOptions()) {
  const issued: Issued[] = [];
  const jar = new Map<string, string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/logout")
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(session(bytes)), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
    ),
  );
  const supabase = createServerClient("http://localhost:54321", "key", {
    cookieOptions: opts,
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) =>
        list.forEach((c) => {
          issued.push(c as Issued);
          if (c.value) jar.set(c.name, c.value);
          else jar.delete(c.name);
        }),
    },
  });
  await supabase.auth.signInWithPassword({ email: "a@b.c", password: "pw" });
  const signIn = issued.splice(0);
  await supabase.auth.signOut();
  return { signIn, signOut: issued.slice() };
}

function header(c: Issued): string {
  const res = NextResponse.next();
  res.cookies.set(c.name, c.value, c.options);
  return res.headers.get("set-cookie") ?? "";
}

function expectHostOnly(list: Issued[]) {
  expect(list.length).toBeGreaterThan(0);
  for (const c of list) {
    expect(c.name).toMatch(/^__Host-sb-auth(\.\d+)?$/);
    const h = header(c);
    expect(h).toMatch(/Path=\/(;|$)/);
    expect(h).toMatch(/;\s*Secure/i);
    expect(h).toMatch(/SameSite=lax/i);
    expect(h).not.toMatch(/Domain=/i);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("auth cookie options (story 24-3)", () => {
  it("sign-in and sign-out cookies are host-only, Secure, prefixed (small session)", async () => {
    const { signIn, signOut } = await drive(10);
    expectHostOnly(signIn);
    expectHostOnly(signOut);
    expect(signOut.every((c) => header(c).match(/Max-Age=0/i))).toBe(true);
  });

  it("every chunk of an oversized session and every removal chunk carries the attributes", async () => {
    const { signIn, signOut } = await drive(9000);
    expect(signIn.length).toBeGreaterThan(1);
    expectHostOnly(signIn);
    expectHostOnly(signOut);
  });

  it("fails if an auth cookie is emitted without the prefix or Secure (unprefixed options)", async () => {
    const { signIn } = await drive(10, {
      ...authCookieOptions(),
      name: "sb-auth",
      secure: false,
    });
    expect(() => expectHostOnly(signIn)).toThrow();
  });

  it("builds the prefixed options by default", () => {
    expect(authCookieOptions({ env: {} })).toEqual({
      name: "__Host-sb-auth",
      secure: true,
      path: "/",
      sameSite: "lax",
    });
  });

  it("dev gate: unprefixed name, secure follows the protocol", () => {
    const env = { AUTH_COOKIE_UNPREFIXED: "1" };
    expect(authCookieOptions({ env })).toMatchObject({
      name: "sb-auth",
      secure: false,
    });
    expect(authCookieOptions({ env, secure: true })).toMatchObject({
      name: "sb-auth",
      secure: true,
    });
  });

  it("gate in production: options builder and startup check throw naming the variable", () => {
    for (const env of [
      { AUTH_COOKIE_UNPREFIXED: "1", APP_ENV: "production" },
      { AUTH_COOKIE_UNPREFIXED: "1", VERCEL_ENV: "production" },
    ]) {
      expect(() => authCookieOptions({ env })).toThrow(
        /AUTH_COOKIE_UNPREFIXED/,
      );
      expect(() => assertNoUnprefixedInProduction(env)).toThrow(
        /AUTH_COOKIE_UNPREFIXED/,
      );
    }
    expect(() =>
      assertNoUnprefixedInProduction({
        AUTH_COOKIE_UNPREFIXED: "1",
        APP_ENV: "preview",
      }),
    ).not.toThrow();
    expect(() =>
      assertNoUnprefixedInProduction({ APP_ENV: "production" }),
    ).not.toThrow();
  });

  it("dev HTTP check: prefixed cookie on a non-localhost http host throws; localhost, https and the gate pass", () => {
    expect(() =>
      assertPrefixedCookieCanStick(
        { protocol: "http:", hostname: "192.168.1.5" },
        {},
      ),
    ).toThrow(/HTTPS|localhost/);
    expect(() =>
      assertPrefixedCookieCanStick(
        { protocol: "http:", hostname: "localhost" },
        {},
      ),
    ).not.toThrow();
    expect(() =>
      assertPrefixedCookieCanStick(
        { protocol: "http:", hostname: "127.0.0.1" },
        {},
      ),
    ).not.toThrow();
    expect(() => assertPrefixedCookieCanStick({ protocol: "http:", hostname: "owner.localhost" }, {})).not.toThrow();
    expect(() =>
      assertPrefixedCookieCanStick(
        { protocol: "https:", hostname: "192.168.1.5" },
        {},
      ),
    ).not.toThrow();
    expect(() =>
      assertPrefixedCookieCanStick(
        { protocol: "http:", hostname: "192.168.1.5" },
        { AUTH_COOKIE_UNPREFIXED: "1" },
      ),
    ).not.toThrow();
    expect(() =>
      assertPrefixedCookieCanStick(
        { protocol: "http:", hostname: "192.168.1.5" },
        { APP_ENV: "production" },
      ),
    ).not.toThrow();
  });

  it("matches legacy names only", () => {
    expect(
      legacyCookieNames([
        "sb-abc-auth-token",
        "sb-abc-auth-token.0",
        "__Host-sb-auth",
        "__Host-sb-auth.0",
        "sb-auth",
        "other",
      ]),
    ).toEqual(["sb-abc-auth-token", "sb-abc-auth-token.0"]);
    expect(
      hasCurrentSessionCookie(["__Host-sb-auth.1"], "__Host-sb-auth"),
    ).toBe(true);
    expect(
      hasCurrentSessionCookie(["sb-abc-auth-token"], "__Host-sb-auth"),
    ).toBe(false);
  });
});
