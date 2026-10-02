import { NextResponse, type NextRequest } from "next/server";
import { negotiateLocale } from "@/lib/i18n";

/**
 * The apex (`gymosapps.com`) carries no locale segment, so something has to
 * choose one. This picks it from the visitor's own Accept-Language header
 * rather than always sending them to English.
 *
 * That choice matters more here than it would on most sites: GymOS sells to
 * gym owners in Cameroon, where a francophone owner typing the domain off a
 * business card is a completely ordinary first visit. Landing them on an
 * English page they then have to notice a toggle to escape is a real cost at
 * exactly the wrong moment.
 *
 * A redirect (not a rewrite) so the URL bar shows the language actually
 * being read, which is also what a visitor copies and shares. 307 rather
 * than 308: the choice depends on a request header, so it must not be
 * cached as a permanent fact about the path.
 */
export function proxy(request: NextRequest) {
  const locale = negotiateLocale(request.headers.get("accept-language"));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}`;
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Only the apex. Every other path -- /en, /fr, /privacy, static assets --
  // is served directly, so this runs once per visitor rather than on every
  // request for every image.
  matcher: ["/"],
};
