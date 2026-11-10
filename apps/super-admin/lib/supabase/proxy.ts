import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import {
  assertPrefixedCookieCanStick,
  authCookieOptions,
  hasCurrentSessionCookie,
  legacyCookieNames,
} from "./cookie-options";

/** Story 24-3: the proxy entry. Old-format session cookies (`sb-<ref>-auth-token*`) are cleared. A request that carries only those
 * (no `__Host-` session) is unauthenticated, so the inner gate decides: where it would send the user to sign-in, they go once to
 * `/auth/login?expired=1` ("session expired" copy); on a public path (auth pages, cron, version, ...) the cookies are only cleared. */
export async function updateSession(request: NextRequest) {
  const names = request.cookies.getAll().map((c) => c.name);
  const legacy = legacyCookieNames(names);
  if (legacy.length === 0) return updateSessionInner(request);

  const current = hasCurrentSessionCookie(names, authCookieOptions({ secure: request.nextUrl.protocol === "https:" }).name);
  legacy.forEach((name) => request.cookies.delete(name));
  let res = await updateSessionInner(request);
  if (!current && res.status === 307) {
    const to = new URL(res.headers.get("location") ?? "/", request.url);
    if (to.pathname === "/auth/login") {
      to.search = "";
      to.searchParams.set("expired", "1");
      res = NextResponse.redirect(to);
    }
  }
  legacy.forEach((name) => res.cookies.set(name, "", { maxAge: 0, path: "/" }));
  return res;
}

async function updateSessionInner(request: NextRequest) {
  assertPrefixedCookieCanStick(request.nextUrl);
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: authCookieOptions({ secure: request.nextUrl.protocol === "https:" }),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    // UpdateNotice polls this from every tab, signed in or not. It returns only
    // the deploy's commit SHA.
    request.nextUrl.pathname !== "/api/version" &&
    // Story 23.9: the e-mail queue worker is called by Vercel Cron and the dashboard with a bearer secret; the route checks it.
    request.nextUrl.pathname !== "/api/email-outbox/drain" &&
    // Story 23.11: the support factor-reset executor, called by Vercel Cron with the same bearer secret; the route checks it.
    request.nextUrl.pathname !== "/api/support-factor-reset/execute"
  ) {
    // `/` is the (admin) route group's own real landing page (redirects to
    // /gyms) as of this cleanup -- not the starter's public marketing page
    // anymore, so it is deliberately no longer exempted here, mirroring
    // apps/dashboard's identical Story 1.8 fix. Defense-in-depth, not the
    // sole gate: app/(admin)/layout.tsx does the authoritative
    // claims/app_role check. No `?next=` param -- unlike apps/dashboard,
    // login-form.tsx always pushes to the single real destination (/gyms)
    // regardless of where the redirect originated, since every (admin)
    // route needs the same app_role, not a deep-linkable per-page return.
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
