"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, CalendarDays, Layers, Pencil, Phone, Send, ShieldCheck, Tag, User, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
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
import { GymNameEditor } from "./GymNameEditor";
import { OwnerContactDialog } from "./OwnerContactDialog";
import { ResendInvitationDialog } from "./ResendInvitationDialog";
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

const STATUS_BADGE_CLASS: Record<string, string> = {
  active: "border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
  suspended: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  deactivated: "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};
const DANGER_BUTTON =
  "border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950 dark:hover:text-red-200";
const SUCCESS_BUTTON =
  "border-green-200 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950 dark:hover:text-green-200";

/** One labelled tile of the gym summary: a small icon, the label, then whatever the field needs (value, editor, actions). */
function InfoCard({
  icon: Icon,
  label,
  className = "",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border bg-background p-4 ${className}`}>
      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4" />
        {label.replace(/:\s*$/, "")}
      </p>
      {children}
    </div>
  );
}

/** The detail page keeps the gym card and any live access on top; the rest are tabs (selected tab in the URL as `?tab=`).
 * Members and payments are separate tabs, each with its own paging params, offered only while data access is granted. */
export const GYM_DETAIL_TABS = ["audit", "support", "members", "payments"] as const;
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
  const [editingOwner, setEditingOwner] = useState(false);
  const [resendingInvitation, setResendingInvitation] = useState(false);
  // The Members and payments tab exists only while this admin holds a live "Access gym data" grant (page.tsx loads the
  // two tables only then); without it the tab is not offered and a ?tab=members link falls back to the first tab.
  const dataUnlocked = members !== null || payments !== null;
  const visibleTabs = GYM_DETAIL_TABS.filter((key) => (key !== "members" && key !== "payments") || dataUnlocked);
  const activeTab = visibleTabs.includes(tab) ? tab : "audit";
  const effectiveCap = gym.memberCapOverride ?? gym.tierMemberCap;
  const usagePercent = effectiveCap ? (gym.memberCount / effectiveCap) * 100 : 0;

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

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
            <Building2 className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <GymNameEditor gym={gym} onSaved={() => router.refresh()} />
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <User className="size-3.5" />
                {gym.ownerName ?? "—"}
              </span>
              {gym.ownerPhone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3.5" />
                  {gym.ownerPhone}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                aria-label={t("gyms.detail.ownerContact.button")}
                onClick={() => setEditingOwner(true)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                aria-label={t("gyms.detail.resendInvitation.button")}
                title={t("gyms.detail.resendInvitation.button")}
                onClick={() => setResendingInvitation(true)}
              >
                <Send className="size-3.5" />
              </Button>
            </p>
          </div>
          <Badge className={`px-3 py-1 text-sm ${STATUS_BADGE_CLASS[gym.status] ?? ""}`}>
            {STATUS_LABEL_KEY[gym.status] ? t(STATUS_LABEL_KEY[gym.status]) : gym.status}
          </Badge>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <InfoCard icon={Tag} label={t("gyms.detail.category")}>
            <GymCategoryEditor gym={gym} onSaved={() => router.refresh()} />
          </InfoCard>

          <InfoCard icon={CalendarDays} label={t("gyms.detail.created")}>
            <span className="text-base font-medium">
              {new Date(gym.createdAt).toLocaleDateString(i18n.language, { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </InfoCard>

          <InfoCard icon={Layers} label={t("gyms.detail.tier")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{gym.tierName}</span>
              <Button variant="outline" size="sm" onClick={() => setChangingTier(true)}>
                {t("gyms.detail.change")}
              </Button>
            </div>
          </InfoCard>

          <InfoCard icon={Users} label={t("gyms.detail.memberCount")}>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">
                  {gym.memberCapOverride !== null
                    ? t("gyms.detail.memberCountOverride", { count: gym.memberCount, cap: gym.memberCapOverride })
                    : gym.tierMemberCap !== null
                      ? t("gyms.detail.memberCountWithCap", { count: gym.memberCount, cap: gym.tierMemberCap })
                      : t("gyms.detail.memberCountNoCap", { count: gym.memberCount })}
                </span>
                <CapOverrideEditor gym={gym} onSaved={() => router.refresh()} />
              </div>
              {effectiveCap !== null && effectiveCap > 0 && (
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${usagePercent >= 100 ? "bg-red-500" : usagePercent >= 80 ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ width: `${Math.min(usagePercent, 100)}%` }}
                  />
                </div>
              )}
            </div>
          </InfoCard>

          <InfoCard icon={ShieldCheck} label={t("gyms.detail.status")} className="sm:col-span-2 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              {gym.status === "active" && (
                <>
                  <Button variant="outline" size="sm" className={DANGER_BUTTON} onClick={() => setLifecycleAction("suspend")}>
                    {t("gyms.actions.suspend")}
                  </Button>
                  <Button variant="outline" size="sm" className={DANGER_BUTTON} onClick={() => setLifecycleAction("deactivate")}>
                    {t("gyms.actions.deactivate")}
                  </Button>
                </>
              )}
              {gym.status === "suspended" && (
                <>
                  <Button variant="outline" size="sm" className={SUCCESS_BUTTON} onClick={() => setLifecycleAction("reinstate")}>
                    {t("gyms.actions.reinstate")}
                  </Button>
                  <Button variant="outline" size="sm" className={DANGER_BUTTON} onClick={() => setLifecycleAction("deactivate")}>
                    {t("gyms.actions.deactivate")}
                  </Button>
                </>
              )}
              {gym.status === "deactivated" && (
                <Button variant="outline" size="sm" className={SUCCESS_BUTTON} onClick={() => setLifecycleAction("reinstate")}>
                  {t("gyms.actions.reinstate")}
                </Button>
              )}
            </div>
          </InfoCard>
        </div>

        {/* Story 1.15 review: `expiresAt` is a server render, so a tab left
            open past the deadline kept asserting that access was live while
            RLS had already stopped honouring the grant. `hasLapsed` drops the
            indicator back to the escalate button once the clock passes it.
            The database remains the authority either way -- this only stops
            the UI contradicting it. */}
        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-6 py-4">
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

      <Tabs value={activeTab} onValueChange={selectTab}>
        <div className="overflow-x-auto">
          <TabsList>
            {visibleTabs.map((key) => (
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
        {dataUnlocked && (
          <>
            <TabsContent value="members">
              <GymMembersTable members={members} />
            </TabsContent>
            <TabsContent value="payments">
              <GymPaymentsTable payments={payments} />
            </TabsContent>
          </>
        )}
      </Tabs>

      {resendingInvitation && (
        <ResendInvitationDialog
          gym={gym}
          onClose={() => setResendingInvitation(false)}
          onDone={() => router.refresh()}
        />
      )}

      {editingOwner && (
        <OwnerContactDialog
          gym={gym}
          onClose={() => setEditingOwner(false)}
          onDone={() => {
            setEditingOwner(false);
            router.refresh();
          }}
        />
      )}

      {escalating && (
        <EscalateAccessDialog
          gym={gym}
          onClose={() => setEscalating(false)}
          onDone={() => {
            setEscalating(false);
            selectTab("members");
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
