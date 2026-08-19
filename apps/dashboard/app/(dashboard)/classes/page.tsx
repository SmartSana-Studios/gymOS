import { Suspense } from "react";

import { listClasses } from "@/services/classes";
import { listCoaches } from "@/services/coaches";
import { getDashboardShellContext } from "@/services/session";
import { ClassesPageClient } from "./components/ClassesPageClient";
import ClassesLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 12.1: Classes admin page (FR-121). Server Component + explicit
 * <Suspense>, copies plans/page.tsx's exact structure -- apps/dashboard's
 * `cacheComponents: true` requires the cookie-based Supabase read to sit
 * inside an explicit Suspense boundary.
 *
 * No route-level role guard beyond (dashboard)/layout.tsx's gym-staff gate
 * -- same discipline as plans/page.tsx: Sidebar hides the create/edit
 * affordances from Receptionist (UI-only, AC #3's UI-hiding half), the real
 * enforcement is the RLS write policies (0057_class_creation_scheduling.sql).
 * A Receptionist who reaches /classes directly gets real read-only data via
 * "gym_staff_read_own_classes"; every write silently no-ops at RLS.
 */
export default function ClassesPage() {
  return (
    <Suspense fallback={<ClassesLoading />}>
      <ClassesData />
    </Suspense>
  );
}

async function ClassesData() {
  const [{ data: classes, error: classesError }, { data: coaches, error: coachesError }, { data: shell, error: shellError }] =
    await Promise.all([listClasses(), listCoaches(), getDashboardShellContext()]);

  if (classesError || coachesError || shellError || !shell) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <ClassesPageClient
      initialClasses={classes ?? []}
      coaches={coaches ?? []}
      role={shell.role}
    />
  );
}
