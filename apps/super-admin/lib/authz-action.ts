import { redirect } from "next/navigation";

import { authorizePlatformAction, type AuthorizeResult, type PlatformCapability } from "@/lib/authz";
import { endsSession, loginRedirectFor } from "@/lib/auth-redirect";

/**
 * The gate for Super Admin Server Actions (Story 22 retro item 53). Same checks as authorizePlatformAction. When
 * the session itself is unusable (expired, over its age or idle limit, locked, below aal2, not a Super Admin) the
 * action REDIRECTS to login or the code prompt, which Next carries to the client, instead of returning an error
 * the page would show as a failure. Any other denial comes back as `{ ok: false, error }` for the caller to return.
 */
export async function authorizeOrRedirect(capability: PlatformCapability): Promise<AuthorizeResult> {
  const authz = await authorizePlatformAction(capability);
  if (!authz.ok && endsSession(authz.reason)) redirect(loginRedirectFor(authz.reason));
  return authz;
}
