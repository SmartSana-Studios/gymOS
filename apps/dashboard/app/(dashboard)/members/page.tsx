import { Suspense } from "react";

import { listMembers, MEMBERS_PAGE_SIZE } from "@/services/members";
import { listPlans } from "@/services/plans";
import { listCoaches } from "@/services/coaches";
import { getGymSettings } from "@/services/gym-settings";
import { getDashboardShellContext } from "@/services/session";
import { MembersPageClient } from "./components/MembersPageClient";
import MembersLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-03 Members List. Server Component + explicit <Suspense> -- same
 * requirement as plans/page.tsx and apps/super-admin's gyms/page.tsx: the
 * cookie-based Supabase read must sit inside an explicit Suspense boundary
 * under this app's `cacheComponents: true`.
 *
 * No route-level role guard beyond (dashboard)/layout.tsx's existing
 * gym-staff gate (matches settings/page.tsx/plans/page.tsx's documented
 * "Sidebar hides it, RLS is the real enforcement" precedent) -- a
 * Receptionist reaching /members directly gets full read access (AC #5, by
 * design), with create/edit/deactivate UI conditionally hidden by role
 * (resolved here via getDashboardShellContext(), the first page in this app
 * to need role outside the layout), backstopped by this story's own
 * manager/owner-only RLS write policies.
 */
export default function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  return (
    <Suspense fallback={<MembersLoading />}>
      <MembersData searchParams={searchParams} />
    </Suspense>
  );
}

async function MembersData({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const parsedPage = params.page ? Number(params.page) : 1;
  // `listMembers` internally clamps an invalid page back to 1 -- mirror that
  // here so the UI's Previous/Next state (passed `page` below) never desyncs
  // from what was actually fetched (e.g. `?page=abc` or `?page=-1`).
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [
    { data: membersPage, error: membersError },
    { data: shell, error: shellError },
    { data: plans, error: plansError },
    { data: coaches, error: coachesError },
    { data: gymSettings, error: gymSettingsError },
  ] = await Promise.all([
    listMembers({ page, search: params.search, status: params.status }),
    getDashboardShellContext(),
    listPlans(),
    listCoaches(),
    getGymSettings(),
  ]);

  if (membersError || shellError || !shell || plansError || coachesError) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  // Story 18.5: only decides which create form the modal shows. The server
  // re-reads the fee in createMember and stays authoritative, so a failed read
  // here falls back to the one-step form (fee 0) and logs; it never fails the page.
  if (gymSettingsError || !gymSettings) {
    console.error("[members] gym settings read failed; registration fee defaulted to 0 for the form", gymSettingsError);
  }
  const registrationFee = gymSettings?.registrationFee ?? 0;

  return (
    <MembersPageClient
      initialMembers={membersPage?.rows ?? []}
      total={membersPage?.total ?? 0}
      page={page}
      pageSize={MEMBERS_PAGE_SIZE}
      search={params.search ?? ""}
      status={params.status ?? ""}
      role={shell.role}
      plans={plans ?? []}
      coaches={coaches ?? []}
      gymName={shell.gymName}
      registrationFee={registrationFee}
    />
  );
}
