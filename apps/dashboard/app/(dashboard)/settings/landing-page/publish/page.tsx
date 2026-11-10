import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getLandingPageData } from "@/services/landing-page";
import { getDashboardShellContext } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { PageLoadingSkeleton } from "../components/PageLoadingSkeleton";
import { PublishScreen } from "../components/PublishScreen";
import { isOfferedTemplate } from "@/lib/pageTemplates";

/** AD-29 Landing Page publish screen: exactly what becomes public, the attestation, [Publish page] and [Unpublish]. */
export default function PublishRoute({ searchParams }: { searchParams: Promise<{ template?: string | string[] }> }) {
  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <PublishData searchParams={searchParams} />
    </Suspense>
  );
}

async function PublishData({ searchParams }: { searchParams: Promise<{ template?: string | string[] }> }) {
  const { data: shell } = await getDashboardShellContext();
  if (!shell || (shell.role !== "owner" && shell.role !== "supervisor" && shell.role !== "support")) {
    redirect("/settings");
  }
  const { data, error } = await getLandingPageData();
  if (error || !data) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{error?.message ?? t("common.loadError")}</div>;
  }
  // The template picked in the editor's modal for a page that is not live yet; anything not offered is ignored.
  const picked = (await searchParams).template;
  return <PublishScreen initial={data} initialTemplate={typeof picked === "string" && isOfferedTemplate(picked) ? picked : undefined} />;
}
