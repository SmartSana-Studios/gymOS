"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ActiveEscalation,
  AuditTrailEntry,
  GymDetail,
  GymMemberPage,
  GymPaymentPage,
  TierOption,
} from "@/services/gyms";
import { GymLifecycleDialog } from "../../components/GymLifecycleDialog";
import { deactivateGym, reinstateGym, suspendGym } from "../../actions";
import { ChangeTierDialog } from "./ChangeTierDialog";
import { CapOverrideEditor } from "./CapOverrideEditor";
import { GymCategoryEditor } from "./GymCategoryEditor";
import { EscalateAccessDialog } from "./EscalateAccessDialog";
import { ActiveAccessList } from "./ActiveAccessList";
import { AuditTrailTab } from "./AuditTrailTab";
import type { RealActor } from "../../../support/actions";
import { GymMembersTable } from "./GymMembersTable";
import { GymPaymentsTable } from "./GymPaymentsTable";
import { hasLapsed, useNow } from "./use-now";
import { GymSupportPanel } from "../../../support/components/GymSupportPanel";
import type { SupportAccountRow, SupportAssignmentRow } from "../../../support/actions";

const STATUS_LABEL_KEY: Record<string, string> = {
  active: "gyms.create.statusActive",
  suspended: "gyms.create.statusSuspended",
  deactivated: "gyms.create.statusDeactivated",
};

/** The detail page keeps the gym card and any live access on top; the rest are tabs (selected tab in the URL as `?tab=`).
 * The two tables stay together in one tab, each with its own paging params. */
export const GYM_DETAIL_TABS = ["audit", "support", "data"] as const;
type GymDetailTab = (typeof GYM_DETAIL_TABS)[number];

function parseTab(value: string | null | undefined): GymDetailTab {
  return (GYM_DETAIL_TABS as readonly string[]).includes(value ?? "") ? (value as GymDetailTab) : "audit";
}

/** SA-03 Gym Detail (Story 1.7 adds the "Access gym data" escalation and
 * the Audit trail tab from SA-03's mockup, FR-072; Story 1.15 adds the
 * grant's expiry deadline and the Active data access list). */
export function GymDetailPageClient({
  gym,
  tiers,
  auditTrail,
  realActors,
  expiresAt,
  activeEscalations,
  currentActorId,
  members,
  payments,
  supportAssignments,
  supportAccounts,
}: {
  gym: GymDetail;
  tiers: TierOption[];
  auditTrail: AuditTrailEntry[];
  realActors?: Record<string, RealActor>;
  /**
   * When the current Super Admin's own live grant on this gym expires, or
   * null if they hold none. A timestamp rather than Story 1.7's `escalated`
   * boolean, because the indicator now has to state the deadline -- and
   * because a boolean is exactly what could not distinguish a live grant
   * from a lapsed one in the first place.
   */
  expiresAt: string | null;
  activeEscalations: ActiveEscalation[];
  /**
   * The viewing Super Admin's own id, so the Active data access list can tell
   * their grant apart from everyone else's and switch the revoke dialog to
   * second-person copy (Story 1.15 review).
   */
  currentActorId: string | null;
  /**
   * Story 1.14 AC #1/#2: `null` means "not escalated" -- page.tsx only
   * fetches these once `escalated` resolves, and GymMembersTable/
   * GymPaymentsTable render nothing at all when their prop is null. This is
   * distinct from "escalated but zero rows," which is its own empty-state
   * copy inside each table.
   */
  members: GymMemberPage | null;
  payments: GymPaymentPage | null;
  /** Story 23.5: Super Admin only; the individual's name is shown here and nowhere an Owner can reach. */
  supportAssignments: SupportAssignmentRow[];
  supportAccounts: SupportAccountRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [tab, setTab] = useState<GymDetailTab>(parseTab(searchParams?.get("tab")));

  function selectTab(value: string) {
    const next = parseTab(value);
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }
  const [lifecycleAction, setLifecycleAction] = useState<
    "suspend" | "deactivate" | "reinstate" | null
  >(null);
  const [changingTier, setChangingTier] = useState(false);
  const [escalating, setEscalating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        <Button asChild variant="outline" size="sm">
          <Link href="/gyms">
            <ArrowLeft />
            {t("gyms.detail.backToGyms")}
          </Link>
        </Button>
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

          <span className="text-muted-foreground">{t("gyms.detail.category")}</span>
          <GymCategoryEditor gym={gym} onSaved={() => router.refresh()} />

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

        {/* Story 1.15 review: `expiresAt` is a server render, so a tab left
            open past the deadline kept asserting that access was live while
            RLS had already stopped honouring the grant. `hasLapsed` drops the
            indicator back to the escalate button once the clock passes it.
            The database remains the authority either way -- this only stops
            the UI contradicting it. */}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          {expiresAt !== null && !hasLapsed(expiresAt, now) ? (
            <>
              <span className="text-sm text-muted-foreground">
                {t("gyms.detail.accessGranted", {
                  expires: new Date(expiresAt).toLocaleString(i18n.language),
                })}
              </span>
              {/* Renewal (Story 1.15 review decision, 2026-09-06). Repeat
                  escalation already mints a fresh 24-hour window
                  (0085:176-182); only the UI withheld it, so an admin
                  mid-investigation had to let access lapse before they could
                  ask for it back. */}
              <Button variant="outline" size="sm" onClick={() => setEscalating(true)}>
                {t("gyms.detail.renewAccess")}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEscalating(true)}>
              {t("gyms.detail.accessGymData")}
            </Button>
          )}
        </div>
      </div>

      <ActiveAccessList
        gym={gym}
        escalations={activeEscalations}
        currentActorId={currentActorId}
        onRevoked={() => router.refresh()}
      />

      <Tabs value={tab} onValueChange={selectTab}>
        <div className="overflow-x-auto">
          <TabsList>
            {GYM_DETAIL_TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`gyms.detail.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="audit">
          <AuditTrailTab entries={auditTrail} realActors={realActors} />
        </TabsContent>
        <TabsContent value="support">
          <GymSupportPanel gymId={gym.id} assignments={supportAssignments} accounts={supportAccounts} />
        </TabsContent>
        <TabsContent value="data" className="space-y-4">
          {members === null && payments === null && (
            <p className="rounded-md border p-6 text-sm text-muted-foreground">{t("gyms.detail.tabs.dataLocked")}</p>
          )}
          <GymMembersTable members={members} />
          <GymPaymentsTable payments={payments} />
        </TabsContent>
      </Tabs>

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
