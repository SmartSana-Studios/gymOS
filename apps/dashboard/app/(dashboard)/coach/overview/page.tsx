import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { listAssignedMembers, type CoachPortalMemberRow } from "@/services/coaches";
import { STATUS_BADGE_CONFIG } from "@/app/(dashboard)/subscriptions/subscriptionLabels";
import CoachOverviewLoading from "./loading";

// Breakdown order, healthiest first -- the order STATUS_BADGE_CONFIG lists them.
const STATUS_ORDER: CoachPortalMemberRow["status"][] = ["active", "expiring_soon", "grace_period", "expired"];

/**
 * Story 17.3 (AC #10): AD-20, the Coach's landing route -- `(dashboard)/page.tsx`
 * redirects every Coach sign-in here, so this is a real page, not a
 * placeholder. It carries AD-20's "My Members At A Glance" widget, built from
 * the already-shipped `listAssignedMembers()`: RLS-scoped to the Coach's own
 * caseload by 0040's coach policies through the `security_invoker`
 * `subscriptions_current` view. No new query, policy or migration.
 *
 * Story 17.5 owns AD-20's other three widgets and per-widget failure
 * isolation. Until then this page has one read, and its failure is the
 * page's inline error, exactly as on coach/page.tsx.
 *
 * Structure mirrors coach/page.tsx: sync default export -> <Suspense> ->
 * async data component. No route-level role guard, per that file's comment.
 */
export default function CoachOverviewPage() {
  return (
    <Suspense fallback={<CoachOverviewLoading />}>
      <CoachOverviewData />
    </Suspense>
  );
}

async function CoachOverviewData() {
  const locale = await getRequestLocale();
  const { t } = await getServerTranslation(locale);
  const { data: members, error } = await listAssignedMembers({});

  if (error || !members) {
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  // AD-20's empty state: AD-14's guidance rather than a widget full of zeros.
  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("coachPortal.emptyNoAssignments")}</p>
      </div>
    );
  }

  const counts = new Map<CoachPortalMemberRow["status"], number>();
  for (const row of members) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  // Story 17.5 seam: My Next Sessions, Needs Follow-Up and Recent Progress
  // Activity join this grid, each in its own boundary.
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t("coachPortal.overview.membersAtAGlance.title")}</h2>
          <Link href="/coach" className="text-sm text-muted-foreground hover:text-foreground">
            {t("coachPortal.overview.membersAtAGlance.viewAll")}
          </Link>
        </div>

        <div>
          <p className="text-2xl font-semibold">{members.length.toLocaleString(locale)}</p>
          <p className="text-sm text-muted-foreground">{t("coachPortal.overview.membersAtAGlance.assignedLabel")}</p>
        </div>

        {/* Label and count side by side rather than one composed sentence:
            "9 active" does not inflect the same way in French. */}
        <ul className="flex flex-wrap gap-2">
          {STATUS_ORDER.filter((status) => counts.has(status)).map((status) => {
            const badge = STATUS_BADGE_CONFIG[status];
            const Icon = badge.icon;
            return (
              <li key={status}>
                <Badge variant="outline" className={badge.className}>
                  <Icon size={12} className="mr-1" />
                  {t(badge.labelKey)}
                  <span className="ml-1 font-semibold">{(counts.get(status) ?? 0).toLocaleString(locale)}</span>
                </Badge>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
