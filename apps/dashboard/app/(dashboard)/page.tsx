import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-02 Overview -- minimal shell only (story Dev Notes -> Scope Boundary /
 * Open Question 2, resolved: no stat cards, tables, or Front-Desk Alert
 * Panel here). `subscriptions`/`attendance_events`/`payments` all have RLS
 * enabled with zero business policies for a gym-scoped role today, so any
 * such query would silently return 0 rows regardless of real gym activity
 * -- deferred to whichever Epic 3/4 story (or a future correct-course pass)
 * ends up owning that build-out.
 */
export default async function OverviewPage() {
  const { t } = await getServerTranslation(await getRequestLocale());
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("overview.title")}</h1>
      <p className="text-muted-foreground">{t("overview.body")}</p>
    </div>
  );
}
