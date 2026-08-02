import { Suspense } from "react";

import { getMemberDetail, listSessionNotes } from "@/services/coaches";
import { CoachMemberDetailPageClient } from "./components/CoachMemberDetailPageClient";
import CoachMemberDetailLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-15 Coach Portal -- member detail & session notes. Server Component +
 * explicit <Suspense>, mirroring coach/page.tsx's exact structure. First
 * dynamic-segment (`[param]`) route in this app -- `params` is a `Promise`
 * under this app's `cacheComponents: true`, same as `searchParams` already
 * is on every other dashboard page.
 *
 * No route-level role guard beyond `(dashboard)/layout.tsx`'s existing
 * gym-staff gate -- same "Sidebar hides it, RLS is the real gate" precedent
 * every other page in this app documents on itself.
 */
export default function CoachMemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  return (
    <Suspense fallback={<CoachMemberDetailLoading />}>
      <CoachMemberDetailData params={params} />
    </Suspense>
  );
}

async function CoachMemberDetailData({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const [{ data: member, error: memberError }, { data: notes, error: notesError }] = await Promise.all([
    getMemberDetail(memberId),
    listSessionNotes(memberId),
  ]);

  // Not a Next.js notFound() 404 -- matches this app's established pattern
  // of every other page rendering its own inline error state
  // (coach/page.tsx, subscriptions/page.tsx) rather than throwing. Covers
  // this story's implicit AC: a member not assigned to the calling coach
  // (or nonexistent, or cross-gym) never leaks data or crashes.
  if (memberError || !member) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("coachPortal.detail.notFound")}</div>;
  }
  if (notesError) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return <CoachMemberDetailPageClient member={member} notes={notes ?? []} />;
}
