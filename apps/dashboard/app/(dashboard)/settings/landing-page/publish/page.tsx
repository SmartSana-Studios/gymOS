import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getLandingPageData } from "@/services/landing-page";
import { getDashboardShellContext } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { PageLoadingSkeleton } from "../components/PageLoadingSkeleton";
import { PublishScreen } from "../components/PublishScreen";

/** AD-29 Landing Page publish screen: exactly what becomes public, the attestation, [Publish page] and [Unpublish]. */
export default function PublishRoute() {
  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <PublishData />
    </Suspense>
  );
}

async function PublishData() {
  const { data: shell } = await getDashboardShellContext();
  if (!shell || (shell.role !== "owner" && shell.role !== "supervisor" && shell.role !== "support")) {
    redirect("/settings");
  }
  const { data, error } = await getLandingPageData();
  if (error || !data) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{error?.message ?? t("common.loadError")}</div>;
  }
  return <PublishScreen initial={data} />;
}
