/**
 * Story 24-3 (AD-44, NFR-026): the one `cookieOptions` for every Supabase client in this app (server.ts, proxy.ts, client.ts).
 * The session cookie is `__Host-sb-auth.N`: `Secure`, `Path=/`, no `Domain`, so a page on a sibling host under the same parent
 * domain cannot set or overwrite it. `secure: true` is explicit because the @supabase/ssr helper omits it and browsers reject a
 * `__Host-` cookie without it. This file is byte-identical in apps/dashboard and apps/super-admin (cookie-options.parity.test.ts
 * fails if they drift), so it imports only the app-env module by a relative path that exists in both.
 */
import { appEnvironment } from "../app-env";

export const PREFIXED_COOKIE_NAME = "__Host-sb-auth";
export const UNPREFIXED_COOKIE_NAME = "sb-auth";
export const UNPREFIXED_GATE = "AUTH_COOKIE_UNPREFIXED";

type Env = Record<string, string | undefined>;

export type AuthCookieOptions = {
  name: string;
  secure: boolean;
  path: "/";
  sameSite: "lax";
};

function gateOn(env: Env): boolean {
  const v = env[UNPREFIXED_GATE]?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Throws when the local-dev gate is set in a production environment. Called from `register()` (server refuses to start) and by
 * `authCookieOptions`. */
export function assertNoUnprefixedInProduction(env: Env = process.env): void {
  if (gateOn(env) && appEnvironment(env) === "production") {
    throw new Error(
      `${UNPREFIXED_GATE} is set in a production environment. It switches the staff session cookie to an unprefixed, non-Secure ` +
        `name for local HTTP development only; remove the variable (story 24-3, AD-44).`,
    );
  }
}

/** Prefixed options. With the gate on (non-production only) the name is `sb-auth` and `secure` follows `secure` (the request
 * protocol; defaults to false because plain-HTTP dev is the point of the gate). */
export function authCookieOptions(opts: { env?: Env; secure?: boolean } = {}): AuthCookieOptions {
  const env = opts.env ?? process.env;
  assertNoUnprefixedInProduction(env);
  if (gateOn(env)) {
    return { name: UNPREFIXED_COOKIE_NAME, secure: opts.secure ?? false, path: "/", sameSite: "lax" };
  }
  return { name: PREFIXED_COOKIE_NAME, secure: true, path: "/", sameSite: "lax" };
}

const LEGACY = /^sb-.+-auth-token(\.\d+)?$/;

/** Names of old-format session cookies (`sb-<ref>-auth-token`, `.N` chunks) among `names`. */
export function legacyCookieNames(names: string[]): string[] {
  return names.filter((n) => LEGACY.test(n));
}

/** True when `names` holds a cookie of the current session (the configured name, bare or chunked). */
export function hasCurrentSessionCookie(names: string[], name: string): boolean {
  return names.some((n) => n === name || (n.startsWith(`${name}.`) && /^\d+$/.test(n.slice(name.length + 1))));
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Dev-time check: a `__Host-` cookie sent over plain HTTP to a non-localhost host is silently rejected by the browser (login
 * "succeeds", nobody is signed in). Throws an explicit error instead. Only in a development environment with the prefix on. */
export function assertPrefixedCookieCanStick(
  url: { protocol: string; hostname: string },
  env: Env = process.env,
): void {
  if (gateOn(env) || appEnvironment(env) !== "development") return;
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `The staff session cookie is "${PREFIXED_COOKIE_NAME}", which browsers only accept over HTTPS or on localhost; ` +
        `${url.protocol}//${url.hostname} would sign in and then lose the session. Use http://localhost, HTTPS, ` +
        `or set ${UNPREFIXED_GATE}=1 for local development (story 24-3).`,
    );
  }
}
