"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { AuditTrailEntry, GymDetail, TierOption } from "@/services/gyms";
import { GymLifecycleDialog } from "../../components/GymLifecycleDialog";
import { deactivateGym, reinstateGym, suspendGym } from "../../actions";
import { ChangeTierDialog } from "./ChangeTierDialog";
import { CapOverrideEditor } from "./CapOverrideEditor";
import { EscalateAccessDialog } from "./EscalateAccessDialog";
import { AuditTrailTab } from "./AuditTrailTab";

/** SA-03 Gym Detail (Story 1.7 adds the "Access gym data" escalation and
 * the Audit trail tab from SA-03's mockup, FR-072). */
export function GymDetailPageClient({
  gym,
  tiers,
  auditTrail,
  escalated,
}: {
  gym: GymDetail;
  tiers: TierOption[];
  auditTrail: AuditTrailEntry[];
  escalated: boolean;
}) {
  const router = useRouter();
  const [lifecycleAction, setLifecycleAction] = useState<
    "suspend" | "deactivate" | "reinstate" | null
  >(null);
  const [changingTier, setChangingTier] = useState(false);
  const [escalating, setEscalating] = useState(false);

  const capLabel =
    gym.memberCapOverride !== null
      ? `${gym.memberCount} / ${gym.memberCapOverride} (override)`
      : gym.tierMemberCap !== null
        ? `${gym.memberCount} / ${gym.tierMemberCap}`
        : `${gym.memberCount} / no cap`;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        <Link href="/gyms" className="hover:underline">
          ← Gyms
        </Link>
        {" / "}
        {gym.name}
      </div>

      <div className="space-y-4 rounded-md border p-6">
        <div className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <span className="text-muted-foreground">Gym Name:</span>
          <span>{gym.name}</span>

          <span className="text-muted-foreground">Owner:</span>
          <span>
            {gym.ownerName ?? "—"}
            {gym.ownerPhone ? ` (${gym.ownerPhone})` : ""}
          </span>

          <span className="text-muted-foreground">Created:</span>
          <span>{new Date(gym.createdAt).toLocaleDateString()}</span>

          <span className="text-muted-foreground">Tier:</span>
          <span className="flex items-center gap-2">
            {gym.tierName}
            <Button variant="outline" size="sm" onClick={() => setChangingTier(true)}>
              Change
            </Button>
          </span>

          <span className="text-muted-foreground">Member count:</span>
          <span className="flex items-center gap-2">
            {capLabel}
            <CapOverrideEditor gym={gym} onSaved={() => router.refresh()} />
          </span>

          <span className="text-muted-foreground">Status:</span>
          <span className="flex items-center gap-2">
            <span className="capitalize">{gym.status}</span>
            {gym.status === "active" && (
              <>
                <Button variant="outline" size="sm" onClick={() => setLifecycleAction("suspend")}>
                  Suspend
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLifecycleAction("deactivate")}
                >
                  Deactivate
                </Button>
              </>
            )}
            {gym.status === "suspended" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLifecycleAction("reinstate")}
                >
                  Reinstate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLifecycleAction("deactivate")}
                >
                  Deactivate
                </Button>
              </>
            )}
            {gym.status === "deactivated" && (
              <Button variant="outline" size="sm" onClick={() => setLifecycleAction("reinstate")}>
                Reinstate
              </Button>
            )}
          </span>
        </div>

        <div className="border-t pt-4">
          {escalated ? (
            <span className="text-sm text-muted-foreground">
              Access granted — you can view this gym&rsquo;s member and payment records.
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEscalating(true)}>
              Access gym data — requires reason (audit-logged)
            </Button>
          )}
        </div>
      </div>

      <AuditTrailTab entries={auditTrail} />

      {escalating && (
        <EscalateAccessDialog
          gym={gym}
          onClose={() => setEscalating(false)}
          onDone={() => {
            setEscalating(false);
            router.refresh();
          }}
        />
      )}

      {lifecycleAction && (
        <GymLifecycleDialog
          gym={gym}
          action={lifecycleAction}
          onClose={() => setLifecycleAction(null)}
          onDone={() => {
            setLifecycleAction(null);
            router.refresh();
          }}
          runAction={
            lifecycleAction === "suspend"
              ? suspendGym
              : lifecycleAction === "deactivate"
                ? deactivateGym
                : reinstateGym
          }
        />
      )}

      {changingTier && (
        <ChangeTierDialog
          gym={gym}
          tiers={tiers}
          onClose={() => setChangingTier(false)}
          onDone={() => {
            setChangingTier(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
