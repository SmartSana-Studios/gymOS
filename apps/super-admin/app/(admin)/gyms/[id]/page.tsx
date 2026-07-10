import { Suspense } from "react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getGymDetail, listGymAuditTrail, listTiers, type AuditTrailEntry } from "@/services/gyms";
import { GymDetailPageClient } from "./components/GymDetailPageClient";
import GymDetailLoading from "./loading";

// SA-03 Gym Detail. Same Server Component + explicit <Suspense> pattern as
// gyms/page.tsx (Story 1.5's cacheComponents: true requirement). Story 1.7
// adds the "Access gym data" escalation and the Audit trail tab (FR-072).
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
    { data: claimsData },
  ] = await Promise.all([
    getGymDetail(id),
    listTiers(),
    listGymAuditTrail(id),
    // getClaims() (local JWT decode) rather than getUser() (a network round
    // trip to the Auth server) -- matches this app's established convention
    // ((admin)/layout.tsx, components/auth-button.tsx) for reading the
    // current actor's identity.
    supabase.auth.getClaims(),
  ]);

  if (gymError || tiersError || auditTrailError) {
    return (
      <div className="text-sm text-red-600">
        Something went wrong on our end. Try refreshing the page.
      </div>
    );
  }

  if (!gym) {
    notFound();
  }

  const currentActorId = claimsData?.claims?.sub ?? null;
  const entries = auditTrail ?? [];

  // "Escalated" is derived from this same audit-trail fetch (a
  // gym_data_escalation row for this gym authored by the current actor)
  // instead of a second audit_log query -- the RLS policies on
  // members/payments remain the sole real authorization check; this is only
  // a read-model convenience for which button/indicator to render.
  const escalated = entries.some(
    (entry) => entry.actionType === "gym_data_escalation" && entry.actorId === currentActorId,
  );

  // Redact other Super Admins' escalation reasons before this data ever
  // reaches the client -- the platform-wide super_admin_read_audit_log
  // policy grants every Super Admin read access to every audit_log row for
  // accountability, but a free-text `reason` can itself describe individual
  // member/payment detail; only the authoring actor (and non-escalation
  // rows, which don't carry that class of content) keep their reason text.
  const auditTrailForDisplay: AuditTrailEntry[] = entries.map((entry) => {
    if (entry.actionType === "gym_data_escalation" && entry.actorId !== currentActorId) {
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
      escalated={escalated}
    />
  );
}
