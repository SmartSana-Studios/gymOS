import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getLandingPageData } from "@/services/landing-page";
import { getDashboardShellContext } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { LandingPageEditor } from "./components/LandingPageEditor";
import { PageLoadingSkeleton } from "./components/PageLoadingSkeleton";

/**
 * AD-27 Landing Page editor. Server Component + explicit <Suspense> (this app's `cacheComponents: true` rule, as staff/page.tsx).
 * Only Owner, Supervisor and assigned support reach it; the database (get_gym_page_status) is the real admission, this redirect is the
 * courtesy for the other roles who have no Settings row.
 */
export default function LandingPageRoute() {
  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <LandingPageData />
    </Suspense>
  );
}

async function LandingPageData() {
  const { data: shell } = await getDashboardShellContext();
  if (!shell || (shell.role !== "owner" && shell.role !== "supervisor" && shell.role !== "support")) {
    redirect("/settings");
  }
  const { data, error } = await getLandingPageData();
  if (error || !data) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{error?.message ?? t("common.loadError")}</div>;
  }
  return <LandingPageEditor initial={data} />;
}
