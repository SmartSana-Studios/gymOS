import { NextResponse, type NextRequest } from "next/server";
import { negotiateLocale } from "@/lib/i18n";
import { readConfig } from "@/lib/gym-site/env";
import { GYM_SITE_PATH, TENANT_HEADER_PREFIX, TENANT_NAME_HEADER, TENANT_PATH_HEADER } from "@/lib/gym-site/names";
import { decideGymRequest } from "@/lib/gym-site/request";

/**
 * Two jobs.
 *
 * 1. Gym hosts (Story 24.10, AD-43). Tenant identity comes from the Host header alone: the first label under PUBLIC_SITE_ROOT_DOMAIN.
 *    A label that fails the name grammar or is reserved is rewritten to the same Route Handler with NO tenant header, which answers the
 *    uniform not-found with no database call (Story 24.12: one path for every hidden cause, so the responses are byte-identical). Any
 *    other label is rewritten to that Route Handler with `x-tenant-name` and `x-tenant-path` set by this proxy. Every inbound `x-tenant-*` header is
 *    deleted first, on EVERY request this proxy sees, so a client can never choose the tenant. The apex, `www.` and any host that is not
 *    under the root domain (a *.vercel.app preview) keep the marketing site.
 *
 * 2. The apex (`gymosapps.com`) carries no locale segment, so something has to choose one. This picks it from the visitor's own
 *    Accept-Language header rather than always sending them to English.
 *
 *    That choice matters more here than it would on most sites: GymOS sells to gym owners in Cameroon, where a francophone owner typing
 *    the domain off a business card is a completely ordinary first visit. Landing them on an English page they then have to notice a
 *    toggle to escape is a real cost at exactly the wrong moment.
 *
 *    A redirect (not a rewrite) so the URL bar shows the language actually being read, which is also what a visitor copies and shares.
 *    307 rather than 308: the choice depends on a request header, so it must not be cached as a permanent fact about the path.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith(TENANT_HEADER_PREFIX)) headers.delete(name);

  const { rootDomain } = readConfig();
  const pathname = request.nextUrl.pathname;
  const decision = decideGymRequest(request.headers.get("host"), pathname, rootDomain);

  if (decision.kind === "not-found") {
    // Story 24.12: NOT answered here. A reserved or malformed label is rewritten to the same route as every other candidate, with no tenant header
    // (the cleanup above already removed any the client sent), so the route handler answers the uniform not-found and makes no database call.
    // Answered directly, it carried other headers than an unknown, unpublished or taken-down label (no `x-middleware-rewrite`, a different
    // `Vary`), which the HTTP gate (scripts/landing-gate/check-http.mjs) found against a running server: FR-207 wants ONE response.
    const url = request.nextUrl.clone();
    url.pathname = GYM_SITE_PATH;
    url.search = "";
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (decision.kind === "asset") return NextResponse.next({ request: { headers } });
  if (decision.kind === "page") {
    headers.set(TENANT_NAME_HEADER, decision.name);
    headers.set(TENANT_PATH_HEADER, decision.pathname);
    const url = request.nextUrl.clone();
    url.pathname = GYM_SITE_PATH;
    url.search = "";
    return NextResponse.rewrite(url, { request: { headers } });
  }

  if (pathname === "/") {
    const locale = negotiateLocale(request.headers.get("accept-language"));
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}`;
    return NextResponse.redirect(url, 307);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // EVERY path: on a gym host every path must be judged (any path other than `/`, `/{code}` and the fonts is the uniform not-found, `/_next/*`
  // included) and every request must pass through the header cleanup above. A marketing host passes untouched (`_next/*` too).
  matcher: ["/:path*"],
};
