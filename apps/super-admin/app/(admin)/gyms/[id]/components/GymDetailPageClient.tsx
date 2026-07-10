"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { AuditTrailEntry, GymDetail, TierOption } from "@/services/gyms";
import { GymLifecycleDialog } from "../../components/GymLifecycleDialog";
import { deactivateGym, reinstateGym, suspendGym } from "../../actions";
import { ChangeTierDialog } from "./ChangeTierDialog";
import { CapOverrideEditor } from "./CapOverrideEditor";
import { EscalateAccessDialog } from "./EscalateAccessDialog";
import { AuditTrailTab } from "./AuditTrailTab";

const STATUS_LABEL_KEY: Record<string, string> = {
  active: "gyms.create.statusActive",
  suspended: "gyms.create.statusSuspended",
  deactivated: "gyms.create.statusDeactivated",
};

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
  const { t } = useTranslation();
  const [lifecycleAction, setLifecycleAction] = useState<
    "suspend" | "deactivate" | "reinstate" | null
  >(null);
  const [changingTier, setChangingTier] = useState(false);
  const [escalating, setEscalating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        <Link href="/gyms" className="hover:underline">
          {t("gyms.detail.backToGyms")}
        </Link>
        {" / "}
        {gym.name}
      </div>

      <div className="space-y-4 rounded-md border p-6">
        <div className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <span className="text-muted-foreground">{t("gyms.detail.gymName")}</span>
          <span>{gym.name}</span>

          <span className="text-muted-foreground">{t("gyms.detail.owner")}</span>
          <span>
            {gym.ownerName ?? "—"}
            {gym.ownerPhone ? ` (${gym.ownerPhone})` : ""}
          </span>

          <span className="text-muted-foreground">{t("gyms.detail.created")}</span>
          <span>{new Date(gym.createdAt).toLocaleDateString()}</span>

          <span className="text-muted-foreground">{t("gyms.detail.tier")}</span>
          <span className="flex items-center gap-2">
            {gym.tierName}
            <Button variant="outline" size="sm" onClick={() => setChangingTier(true)}>
              {t("gyms.detail.change")}
            </Button>
          </span>

          <span className="text-muted-foreground">{t("gyms.detail.memberCount")}</span>
          <span className="flex items-center gap-2">
            {gym.memberCapOverride !== null
              ? t("gyms.detail.memberCountOverride", { count: gym.memberCount, cap: gym.memberCapOverride })
              : gym.tierMemberCap !== null
                ? t("gyms.detail.memberCountWithCap", { count: gym.memberCount, cap: gym.tierMemberCap })
                : t("gyms.detail.memberCountNoCap", { count: gym.memberCount })}
            <CapOverrideEditor gym={gym} onSaved={() => router.refresh()} />
          </span>

          <span className="text-muted-foreground">{t("gyms.detail.status")}</span>
          <span className="flex items-center gap-2">
            <span>{STATUS_LABEL_KEY[gym.status] ? t(STATUS_LABEL_KEY[gym.status]) : gym.status}</span>
            {gym.status === "active" && (
              <>
                <Button variant="outline" size="sm" onClick={() => setLifecycleAction("suspend")}>
                  {t("gyms.actions.suspend")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLifecycleAction("deactivate")}
                >
                  {t("gyms.actions.deactivate")}
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
                  {t("gyms.actions.reinstate")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLifecycleAction("deactivate")}
                >
                  {t("gyms.actions.deactivate")}
                </Button>
              </>
            )}
            {gym.status === "deactivated" && (
              <Button variant="outline" size="sm" onClick={() => setLifecycleAction("reinstate")}>
                {t("gyms.actions.reinstate")}
              </Button>
            )}
          </span>
        </div>

        <div className="border-t pt-4">
          {escalated ? (
            <span className="text-sm text-muted-foreground">{t("gyms.detail.accessGranted")}</span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEscalating(true)}>
              {t("gyms.detail.accessGymData")}
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
