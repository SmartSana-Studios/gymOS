import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - _next/webpack-hmr (LEGACY; kept only because it is a harmless no-op.
     *   Story 1.18 correction: this used to claim the exclusion is what stops
     *   the proxy returning the auth redirect's 307 instead of the 101
     *   Switching Protocols, breaking dev hydration. That is NOT what
     *   happens, and reasoning from it cost a multi-hour misdiagnosis.
     *   `webpack-hmr` is the pre-Next-16 endpoint name -- Next 16's HMR
     *   socket is `_next/hmr`, so this pattern matches nothing. Correcting it
     *   to `_next/(?:webpack-)?hmr` was tried and changed nothing: the
     *   handshake returns a correct 101 with the proxy untouched. The proxy
     *   is not, and never was, involved.
     *
     *   A genuinely dead HMR socket in dev comes from `allowedDevOrigins` --
     *   see the comment in next.config.ts. When Next blocks a cross-origin
     *   dev request it prints the exact remedy to the dev-server terminal,
     *   so READ THE `pnpm dev` OUTPUT FIRST: the browser side of that
     *   failure is silent and every server-side diagnostic looks clean.)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
