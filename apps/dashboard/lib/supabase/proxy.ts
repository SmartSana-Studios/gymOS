import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

/**
 * Story 23-6b: the one request-level gate for a second-factor session. Only GymOS support holds an authenticator on this app, so a
 * JWT at `aal2` is a support session. `session_gate_touch` (service role) applies the idle / absolute limits, the account lock and
 * the velocity lock, and records the heartbeat the live gate (`private.support_live`) reads. Any error or non-ok answer fails
 * closed. Because the proxy sees every request -- pages, Server Actions and route handlers alike -- this is the only place the
 * gate is called; proxy.gate.test.ts fails if a path can bypass it.
 */
async function sessionGateAllows(userId: string | undefined, sessionId: string | undefined): Promise<boolean> {
  try {
    if (!userId || !sessionId) return false;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return false;
    const admin = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.rpc("session_gate_touch", { p_user: userId, p_session: sessionId });
    const row = Array.isArray(data) ? data[0] : null;
    return !error && row != null && row.ok === true;
  } catch {
    return false;
  }
}

export async function updateSession(request: NextRequest) {
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

  // Story 23-6b: the session gate. Deliberately before every path exemption below and not conditioned on the path: a second-factor
  // session is gated on every request, the auth pages and the picker included.
  const claims = user as
    | { sub?: string; aal?: string; session_id?: string; app_role?: string; gym_id?: string }
    | null
    | undefined;
  const pathname = request.nextUrl.pathname;
  // /api/version carries no tenant data and is polled from every open tab: it must neither run the gate nor count as activity
  // (a heartbeat from an idle tab would keep the idle limit from ever firing).
  if (claims?.aal === "aal2" && pathname !== "/api/version") {
    const allowed = await sessionGateAllows(claims.sub, claims.session_id);
    if (!allowed) {
      try {
        // Clears the auth cookies on supabaseResponse (copied onto the redirect below).
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // The gate already removed the session row on a breach; a cookie that cannot be cleared is refused again next request.
      }
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      url.search = "";
      url.searchParams.set("expired", "1");
      const redirect = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    }

    // A support request acts on exactly one explicit, still-assigned gym. No gym claim yet (just after the code step), or a claim for
    // a gym whose assignment has since been unassigned, switched off or suspended (the JWT can outlive it), goes back to the picker.
    const onPicker = pathname === "/support-gym" || pathname.startsWith("/support-gym/");
    const onAuth = pathname.startsWith("/auth/");
    // Epic 23 retro: a person whose recertification is overdue is refused by the live gate (every gym row reads as empty). Say why
    // instead of letting the pages fail with a generic error. This is a message only: the denial does not depend on it.
    const onRecertification = pathname === "/support-recertification" || pathname.startsWith("/support-recertification/");
    if (claims.app_role === "support" && !onRecertification && !onAuth) {
      const { data: overdue } = await supabase.rpc("support_recertification_overdue");
      if (overdue === true) {
        const url = request.nextUrl.clone();
        url.pathname = "/support-recertification";
        url.search = "";
        const redirect = NextResponse.redirect(url);
        supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
        return redirect;
      }
    }
    if (!onPicker && !onAuth && !onRecertification) {
      let needsPicker = false;
      if (claims.app_role === "support") {
        const { data: gyms, error: gymsError } = await supabase.rpc("list_own_support_gyms");
        const assigned = Array.isArray(gyms) ? gyms.map((g: { gym_id: string }) => g.gym_id) : [];
        needsPicker = Boolean(gymsError) || !claims.gym_id || !assigned.includes(claims.gym_id);
      } else if (!claims.gym_id) {
        needsPicker = true;
      }
      if (needsPicker) {
        const url = request.nextUrl.clone();
        url.pathname = "/support-gym";
        url.search = "";
        const redirect = NextResponse.redirect(url);
        // Keep any cookies getClaims() refreshed on this request.
        supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
        return redirect;
      }
    }
  }

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    // Story 11.3: found via live-evidence testing -- without this
    // exemption, Vercel's own cron invocation (genuinely unauthenticated at
    // the session-cookie layer, authenticated only via the route's own
    // CRON_SECRET bearer check) would be redirected to /auth/login before
    // the route handler ever runs, silently breaking the entire scheduled
    // job in production. Any future /api/cron/* route inherits this same
    // exemption -- each one is responsible for its own auth (CRON_SECRET),
    // matching this route's own established pattern.
    !request.nextUrl.pathname.startsWith("/api/cron/") &&
    // UpdateNotice polls this from every tab, signed in or not (a stale login
    // page needs the notice too). It returns only the deploy's commit SHA.
    request.nextUrl.pathname !== "/api/version" &&
    // The published privacy policy (app/privacy/page.tsx) is a store-listing
    // requirement: App Store Connect and Play Console fetch this URL
    // unauthenticated at submission time and re-check it periodically after
    // the listing is live. Without this exemption the proxy answers both of
    // them with a 307 to /auth/login, which reads as "no privacy policy" and
    // fails review -- the page itself renders fine, so this would only ever
    // have surfaced from outside a logged-in browser session.
    !request.nextUrl.pathname.startsWith("/privacy") &&
    // Story 23.4: the support invitee has no session yet; the single-use link token is the credential and every step
    // re-checks it in the database (services/supportInvite.ts). Exact path or a child, not a prefix match on other routes.
    request.nextUrl.pathname !== "/support-invite" &&
    !request.nextUrl.pathname.startsWith("/support-invite/") &&
    // Story 23.11: the cancel link of a support authenticator reset, opened by a person who has just lost access (same reasoning).
    request.nextUrl.pathname !== "/support-reset-cancel" &&
    !request.nextUrl.pathname.startsWith("/support-reset-cancel/")
  ) {
    // `/` is AD-02 Overview (protected, Receptionist+) -- not the starter's
    // public marketing page anymore, so it is deliberately no longer
    // exempted here (Story 1.8). This is defense-in-depth, not the sole
    // gate: app/(dashboard)/layout.tsx does the authoritative claims/role
    // check. Preserve the originally-requested path so login can redirect
    // back to it (AD-01's "redirect to AD-02 or originally-requested deep
    // link").
    const url = request.nextUrl.clone();
    // Preserve the original query string too (e.g. /members?filter=expiring),
    // not just the pathname -- otherwise the post-login redirect drops it
    // and lands the user on an unfiltered page (Review finding).
    const next = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/auth/login";
    url.search = "";
    url.searchParams.set("next", next);
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
