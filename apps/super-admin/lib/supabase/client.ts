import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions } from "./cookie-options";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Story 24-3: same options as the server clients. The dev gate reaches the browser as NEXT_PUBLIC_AUTH_COOKIE_UNPREFIXED
      // (next.config.ts); the cookie is deliberately not HttpOnly because this client reads it.
      cookieOptions: authCookieOptions({
        env: { AUTH_COOKIE_UNPREFIXED: process.env.NEXT_PUBLIC_AUTH_COOKIE_UNPREFIXED },
        secure: typeof location !== "undefined" && location.protocol === "https:",
      }),
    },
  );
}
