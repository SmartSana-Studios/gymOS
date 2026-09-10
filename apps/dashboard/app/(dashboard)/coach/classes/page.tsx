import { Suspense } from "react";

import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 17.3 (AC #11): a route shell, so the Portal sub-nav's My Classes item
 * does not 404. STORY 17.4 OWNS THIS FILE'S REAL CONTENTS -- AD-21's
 * coach-scoped class list, session expansion, and the
 * `list_my_class_session_roster()` RPC in migration 0096. Extend this file
 * there rather than rewriting around it.
 *
 * Deliberately empty of data: no `classes` query, and no resolution of the
 * Coach's own `members.id` (17.4's AC#1). Nor does it render AD-21's "You are
 * not assigned to any classes yet" empty state, which would be false for a
 * Coach who does teach classes. 17.4 ships in the same release (decided
 * 2026-09-10), so this note must never reach a customer; if a release is ever
 * cut without 17.4, hold My Classes out of CoachPortalNav instead.
 */
export default function CoachClassesPage() {
  return (
    <Suspense fallback={null}>
      <CoachClassesData />
    </Suspense>
  );
}

async function CoachClassesData() {
  const { t } = await getServerTranslation(await getRequestLocale());
  return <p className="text-sm text-muted-foreground">{t("coachPortal.classes.pendingNote")}</p>;
}
