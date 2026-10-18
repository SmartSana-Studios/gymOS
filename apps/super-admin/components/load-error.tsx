import { redirect } from "next/navigation";

import { authorizePlatformAction, type AuthorizeResult } from "@/lib/authz";
import { endsSession, loginRedirectFor } from "@/lib/auth-redirect";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Shown when an admin page's data load failed. Next renders a page in parallel with its layout, so when the
 * session has just ended (idle or age limit) the page's own query fails before the layout's redirect lands.
 * Re-check authorization first: a session that is gone goes to login (with the right notice), never to
 * "Something went wrong". A failure we cannot attribute to the session (for example the backend being briefly
 * unreachable, so authorization itself is unavailable) shows the message instead of silently bouncing the user.
 */
export async function LoadError() {
  let authz: AuthorizeResult | null = null;
  try {
    authz = await authorizePlatformAction("platform.admin_access");
  } catch {
    authz = null;
  }
  if (authz && !authz.ok && endsSession(authz.reason)) redirect(loginRedirectFor(authz.reason));
  const { t } = await getServerTranslation(await getRequestLocale());
  return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
}
