import { Suspense } from "react";

import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { getDashboardShellContext } from "@/services/session";
import { listPickerCoaches } from "@/services/coachPicker";
import { CoachPortalNav, CoachPortalNavFallback } from "./components/CoachPortalNav";
import { CoachPickerHeader, CoachPickerHeaderFallback } from "./components/CoachPickerHeader";
import { CoachPickerNav } from "./components/CoachPickerNav";
import { PICKER_ROLES } from "./pickerContext";

/**
 * Story 17.3 (AC #6, #9, #13): the Coach Portal's shared frame -- the heading
 * and the sub-nav -- on `/coach`, `/coach/overview`, `/coach/classes` and
 * `/coach/[memberId]` (EXPERIENCE.md, AD-20). A Server Component; only the
 * sub-nav's active-state read crosses into the client, the same split as
 * apps/super-admin's AdminNavLink.
 *
 * The nested <Suspense> around CoachPortalNav is load-bearing, and `next
 * build` will NOT flag its absence. `useSelectedLayoutSegment()` suspends
 * under `cacheComponents` on `/coach/[memberId]`, which has no
 * `generateStaticParams`. The build only needs *some* ancestor boundary, and
 * `(dashboard)/layout.tsx`'s `fallback={null}` already is one -- so without
 * this boundary the build still passes while the whole dashboard chrome
 * blanks during streaming on member detail. Pinned by layout.test.tsx.
 *
 * This layout is async (the translation read touches cookies and `users`) and
 * has no sync-shell split of its own only because `(dashboard)/layout.tsx`
 * wraps `children` -- this layout included -- in that same ancestor boundary.
 * Do not narrow or remove it (spec-cache-components-suspense-boundary-fix.md).
 *
 * Story 29.4 (FR-053 amended, FR-247): the one role guard of the Portal lives here. A Receptionist or GymOS Support gets the global permission message
 * on every `/coach/*` route, and none of the page's reads run (the page is never rendered). An Owner, Supervisor or Manager gets the coach picker
 * (select, read-only banner, then the Classes and Members tabs) in place of the Coach's own three-item sub-nav; the Coach role is exactly as before.
 * The role is the shell's (the claim) and only chooses the screen: every read behind it re-checks the live role in the database. The layout reads the
 * gym's active coaches once for the select (a layout cannot see search params, so the chosen coach is read by each page and by the client header).
 *
 * It renders inside
 * `(dashboard)/layout.tsx`'s `key={shell.gymId}` Fragment, so a gym switch
 * remounts it with the page; the sub-nav holds no state worth keeping.
 *
 * AD-15's mockup gives member detail a `← Coach Portal / [Member Name]`
 * breadcrumb instead of this heading. Deferred (deferred-work.md, Story
 * 17.3): member detail gets the shared heading, and the lit My Members item
 * is its way back.
 */
export default async function CoachPortalLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getServerTranslation(await getRequestLocale());
  const { data: shell } = await getDashboardShellContext();
  const role = shell?.role;

  if (role === "receptionist" || role === "support") {
    return (
      <div role="alert" className="text-sm text-red-600">
        {t("errors.permissionDenied")}
      </div>
    );
  }

  const isPicker = role !== undefined && PICKER_ROLES.includes(role);
  const coaches = isPicker ? ((await listPickerCoaches()).data ?? []).filter((coach) => coach.isActive) : [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("coachPortal.title")}</h1>
      {isPicker ? (
        <>
          <Suspense fallback={<CoachPickerHeaderFallback />}>
            <CoachPickerHeader coaches={coaches.map((coach) => ({ id: coach.id, name: coach.name }))} />
          </Suspense>
          <Suspense fallback={<CoachPortalNavFallback />}>
            <CoachPickerNav />
          </Suspense>
        </>
      ) : (
        <Suspense fallback={<CoachPortalNavFallback />}>
          <CoachPortalNav />
        </Suspense>
      )}
      {children}
    </div>
  );
}
