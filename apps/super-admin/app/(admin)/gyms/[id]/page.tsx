import { Suspense } from "react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getActiveEscalationForCurrentActor,
  getGymDetail,
  listActiveEscalations,
  listGymAuditTrail,
  listTiers,
  type AuditTrailEntry,
} from "@/services/gyms";
import { GymDetailPageClient } from "./components/GymDetailPageClient";
import GymDetailLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// SA-03 Gym Detail. Same Server Component + explicit <Suspense> pattern as
// gyms/page.tsx (Story 1.5's cacheComponents: true requirement). Story 1.7
// adds the "Access gym data" escalation and the Audit trail tab (FR-072);
// Story 1.15 adds the grant's 24-hour expiry and the Active data access
// list. Every read below stays inside this <Suspense> boundary -- the two
// new escalation reads are cookie-dependent like the rest, and hoisting one
// out would trip cacheComponents.
export default function GymDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<GymDetailLoading />}>
      <GymDetailData params={params} />
    </Suspense>
  );
}

async function GymDetailData({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [
    { data: gym, error: gymError },
    { data: tiers, error: tiersError },
    { data: auditTrail, error: auditTrailError },
    { data: ownEscalation, error: ownEscalationError },
    { data: activeEscalations, error: activeEscalationsError },
    { data: claimsData },
  ] = await Promise.all([
    getGymDetail(id),
    listTiers(),
    listGymAuditTrail(id),
    // Story 1.15: the current actor's own live grant, if any. Replaces the
    // audit-trail-derived `escalated` boolean this page used to compute --
    // that derivation could not see expiry or revocation, so it would have
    // rendered "Access granted" over a lapsed grant while RLS correctly
    // returned nothing.
    getActiveEscalationForCurrentActor(id),
    // Every Super Admin currently holding access to this gym (AC #3), which
    // is what makes another admin's grant revocable at all.
    listActiveEscalations(id),
    // getClaims() (local JWT decode) rather than getUser() (a network round
    // trip to the Auth server) -- matches this app's established convention
    // ((admin)/layout.tsx) for reading the current actor's identity.
    supabase.auth.getClaims(),
  ]);

  if (
    gymError ||
    tiersError ||
    auditTrailError ||
    ownEscalationError ||
    activeEscalationsError
  ) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  if (!gym) {
    notFound();
  }

  const currentActorId = claimsData?.claims?.sub ?? null;
  const entries = auditTrail ?? [];

  // Redact other Super Admins' escalation reasons before this data ever
  // reaches the client -- the platform-wide super_admin_read_audit_log
  // policy grants every Super Admin read access to every audit_log row for
  // accountability, but a free-text `reason` can itself describe individual
  // member/payment detail; only the authoring actor (and non-escalation
  // rows, which don't carry that class of content) keep their reason text.
  //
  // `gym_data_escalation_revoked` is redacted on the same terms as of the
  // Story 1.15 review. Those rows carry a free-text `reason` too (0085:259)
  // and were rendering verbatim to every Super Admin -- an inconsistency in
  // the very control this block exists to apply. Kept as one list so a future
  // reason-carrying action type is an obvious one-line addition here.
  const REDACTED_REASON_ACTION_TYPES = new Set([
    "gym_data_escalation",
    "gym_data_escalation_revoked",
  ]);

  const auditTrailForDisplay: AuditTrailEntry[] = entries.map((entry) => {
    if (REDACTED_REASON_ACTION_TYPES.has(entry.actionType) && entry.actorId !== currentActorId) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
      const { reason: _reason, ...rest } = entry.metadata;
      return { ...entry, metadata: rest };
    }
    return entry;
  });

  return (
    <GymDetailPageClient
      gym={gym}
      tiers={tiers ?? []}
      auditTrail={auditTrailForDisplay}
      expiresAt={ownEscalation?.expiresAt ?? null}
      activeEscalations={activeEscalations ?? []}
      currentActorId={currentActorId}
    />
  );
}
