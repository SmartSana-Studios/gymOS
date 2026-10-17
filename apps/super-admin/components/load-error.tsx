import { redirect } from "next/navigation";

import { authorizePlatformAction } from "@/lib/authz";
import { loginRedirectFor } from "@/lib/auth-redirect";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Shown when an admin page's data load failed. Next renders a page in parallel with its layout, so when the
 * session has just ended (idle or age limit) the page's own query fails before the layout's redirect lands.
 * Re-check authorization first: a session that is gone goes to login (with the right notice), never to
 * "Something went wrong". Only a genuine load failure for an authorized caller shows the message.
 */
export async function LoadError() {
  const authz = await authorizePlatformAction("platform.admin_access");
  if (!authz.ok) redirect(loginRedirectFor(authz.reason));
  const { t } = await getServerTranslation(await getRequestLocale());
  return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
}
