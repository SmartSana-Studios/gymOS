"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Eye,
  Pencil,
  Send,
  Ban,
  MoreVertical,
  Banknote,
  Gift,
  Undo2,
  UserPlus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TablePagination } from "@/components/TablePagination";
import { useUrlPagination } from "@/hooks/use-table-pagination";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { MemberListRow } from "@/services/members";
import type { PlanRow } from "@/services/plans";
import type { CoachRow } from "@/services/coaches";
import type { MemberRole } from "@/services/session";
import { exportMembersCsv, sendMemberInvite } from "../actions";
import { isAwaitingRegistrationFee, resolveBadgeStatus, STATUS_BADGE_CONFIG } from "../memberLabels";
import { MemberModal } from "./MemberModal";
import { DeactivateMemberDialog } from "./DeactivateMemberDialog";
import { CsvImportModal } from "./CsvImportModal";
import { InviteMemberModal } from "./InviteMemberModal";
import { CollectRegistrationFeeDialog } from "./CollectRegistrationFeeDialog";
import { WaiveRegistrationFeeDialog } from "./WaiveRegistrationFeeDialog";
import { VoidRegistrationFeeDialog } from "./VoidRegistrationFeeDialog";
import { AssignInitialPlanDialog } from "./AssignInitialPlanDialog";

const STATUS_OPTIONS = [
  "",
  "active",
  "expiring_soon",
  "grace_period",
  "expired",
  "deactivated",
  "awaiting_registration_fee",
] as const;
const STATUS_LABEL_KEY: Record<(typeof STATUS_OPTIONS)[number], string> = {
  "": "members.statusAll",
  active: "members.status.active",
  expiring_soon: "members.status.expiringSoon",
  grace_period: "members.status.gracePeriod",
  expired: "members.status.expired",
  deactivated: "members.status.deactivated",
  awaiting_registration_fee: "members.status.awaitingRegistrationFee",
};

// Supervisor included per EXPERIENCE.md:206's "Manager-plus" definition -- the
// role sits ABOVE Manager in the hierarchy (Owner -> Supervisor -> Manager),
// so anything Manager can do here it can do too. UI-hiding half only; the real
// enforcement is manager_or_owner_insert/update_own_members, widened alongside.
const CAN_MANAGE: MemberRole[] = ["manager", "supervisor", "owner"];

// Migration 0102: the front desk registers walk-ins, so a receptionist may also
// create a member and assign the first plan (the two INSERT policies). Editing,
// CSV import, deactivation and waiving stay manager-plus.
const CAN_CREATE: MemberRole[] = ["receptionist", "manager", "supervisor", "owner"];

// Story 18.6 registration-fee actions. These mirror the RPCs (the RPC is the
// authority): collect is any staff role that can record payments, waive and
// assign-plan are Manager-plus, void is owner and supervisor only.
const CAN_COLLECT_FEE: MemberRole[] = ["receptionist", "manager", "supervisor", "owner"];
const CAN_VOID_FEE: MemberRole[] = ["supervisor", "owner"];

export function MembersPageClient({
  initialMembers,
  total,
  page,
  pageSize,
  search,
  status,
  role,
  plans,
  coaches,
  gymName,
  registrationFee = 0,
  phoneCountry,
  mobileMoneyEnabled = false,
}: {
  initialMembers: MemberListRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  role: MemberRole;
  plans: PlanRow[];
  coaches: CoachRow[];
  gymName: string;
  registrationFee?: number;
  /** gyms.country (ISO alpha-2); how CSV import reads numbers without a country code. */
  phoneCountry?: string;
  /** Story 18.6: whether the collect dialog offers Tara Money. A UI hint only;
   * the initiate action re-checks availability. */
  mobileMoneyEnabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pagination = useUrlPagination();
  const canManage = CAN_MANAGE.includes(role);
  const canCreate = CAN_CREATE.includes(role);
  const canCollectFee = CAN_COLLECT_FEE.includes(role);
  const canVoidFee = CAN_VOID_FEE.includes(role);

  const [searchInput, setSearchInput] = useState(search);
  const [modalState, setModalState] = useState<{ member: MemberListRow | null; readOnly: boolean } | null>(null);
  const [deactivatingMember, setDeactivatingMember] = useState<MemberListRow | null>(null);
  const [invitingMember, setInvitingMember] = useState<MemberListRow | null>(null);
  const [collectingMember, setCollectingMember] = useState<MemberListRow | null>(null);
  const [waivingMember, setWaivingMember] = useState<MemberListRow | null>(null);
  const [voidingMember, setVoidingMember] = useState<MemberListRow | null>(null);
  const [assigningMember, setAssigningMember] = useState<MemberListRow | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Resync when the URL's `search` param changes externally (browser
  // back/forward) -- matches GymsPageClient's established precedent.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(search);
  }, [search]);

  // AC #4's literal requirement: search filters live with a 300ms debounce,
  // not on Enter/button click (the one deliberate deviation from
  // GymsPageClient's Enter-to-search pattern).
  useEffect(() => {
    if (searchInput === search) return;
    const handle = setTimeout(() => {
      updateParams({ search: searchInput, page: 1 });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function updateParams(next: { search?: string; status?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.search !== undefined) {
      if (next.search) params.set("search", next.search);
      else params.delete("search");
    }
    if (next.status !== undefined) {
      if (next.status) params.set("status", next.status);
      else params.delete("status");
    }
    params.set("page", String(next.page ?? 1));
    router.push(`${pathname}?${params.toString()}`);
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function openCreate() {
    setModalState({ member: null, readOnly: false });
  }

  // Always read-only -- View's own label must match its behavior for every
  // role, not just non-managers. Editing (for roles that can) is a separate,
  // explicit action (openEdit below), not an implicit side effect of "View".
  function openView(member: MemberListRow) {
    setModalState({ member, readOnly: true });
  }

  function openEdit(member: MemberListRow) {
    setModalState({ member, readOnly: false });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { data, error } = await exportMembersCsv({ search, status });
      if (error) {
        // exportMembersCsv already localizes members.errors.exportTooLarge
        // server-side -- use it directly instead of a second, separately-
        // maintained client key with the same copy.
        showToast(error.message);
        return;
      }
      if (data) {
        const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "members.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch {
      showToast(t("common.somethingWentWrong"));
    } finally {
      setExporting(false);
    }
  }

  // Story 2.10 (AC #1-#4): Send Invite now attempts an automated WhatsApp
  // send first -- InviteMemberModal only opens as the failure-path fallback
  // (AC #3), not on every click. No disabled/one-shot guard is added after
  // send: the button stays clickable for a resend (AC #4's explicit
  // "resending is not blocked" requirement).
  // The first message a member gets: sent automatically once the registration fee
  // is settled (collected or waived), because an awaiting member has no access
  // yet and the invite is held back until then. Fire-and-forget from the staff's
  // point of view: the fee is already settled, so a failed send only changes the
  // toast ("send it from the row menu"). Once per member per page session, since
  // the Tara path can report "paid" through both Realtime and the polling read.
  // Tara payments confirmed while no dashboard is open are NOT covered -- staff
  // use the row-menu Send invite for those.
  const autoInvitedRef = useRef(new Set<string>());
  async function sendAutoInvite(member: MemberListRow): Promise<"sent" | "failed" | "skipped"> {
    if (!member.phone || autoInvitedRef.current.has(member.id)) return "skipped";
    autoInvitedRef.current.add(member.id);
    try {
      const { data } = await sendMemberInvite(member.id);
      return data?.sent ? "sent" : "failed";
    } catch {
      return "failed";
    }
  }

  async function handleSendInvite(member: MemberListRow) {
    // Story 18.5: the menu item is disabled for these rows; this is the
    // backstop (and sendMemberInvite re-checks server-side).
    if (isAwaitingRegistrationFee(member)) {
      showToast(t("members.invite.awaitingRegistrationFee"));
      return;
    }
    setSendingInviteId(member.id);
    // Shared by both the "gateway unreachable" (`sent: false`) result below and an unexpected
    // thrown exception in the catch block -- both are the same "couldn't confirm the automated
    // send, use the manual fallback" outcome from the user's perspective (code review fix: this
    // was previously two independently-maintained copies of the same two lines).
    const showFallback = () => {
      showToast(t("members.invite.sendFailedFallback"));
      setInvitingMember(member);
    };
    try {
      const { data, error } = await sendMemberInvite(member.id);
      if (data?.sent) {
        showToast(t("members.invite.sentConfirmation", { name: member.name }));
        return;
      }
      if (error) {
        // A genuine failure (e.g. member not found/stale row) -- surface the
        // server's own message instead of the generic gateway-down fallback
        // copy, and skip the fallback modal (mirrors handleExport's { data,
        // error } handling above; code review fix -- this branch previously
        // discarded `error` entirely and treated it identically to the
        // expected `sent: false` gateway-unreachable case below).
        showToast(error.message);
        return;
      }
      // A `sent: false` result with `error: null` is the expected "gateway
      // unreachable or not configured" outcome AC #3 requires the client to
      // render as the fallback state.
      showFallback();
    } catch {
      showFallback();
    } finally {
      // Only clear if this row is still the in-flight one -- a second Send Invite click on a
      // different member before this one resolves would otherwise have its own still-pending
      // "sending" state (and disabled button) cleared early by this unrelated completion,
      // letting the user double-send the second invite (Review finding, Story 2.10).
      setSendingInviteId((current) => (current === member.id ? null : current));
    }
  }


  function expiryLabel(member: MemberListRow): string {
    if (!member.expiryDate) return "—";
    // Parsing a date-only string ("YYYY-MM-DD") via `new Date(string)`
    // interprets it as UTC midnight, then `.toLocaleDateString()` renders it
    // in the viewer's local timezone -- for a negative-UTC-offset viewer
    // that rolls the displayed date back a day (code review fix). Building
    // the Date from local Y/M/D components instead avoids any UTC shift.
    const [year, month, day] = member.expiryDate.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(i18n.language);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("members.title")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? t("members.export.exporting") : t("members.export.button")}
          </Button>
          {canManage && (
            <Button variant="outline" onClick={() => setCsvImportOpen(true)}>
              {t("members.importCsv")}
            </Button>
          )}
          {canCreate && <Button onClick={openCreate}>{t("members.addMember")}</Button>}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="membersSearch" className="invisible">
            {t("members.searchLabel")}
          </Label>
          <Input
            id="membersSearch"
            placeholder={t("members.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="membersStatusFilter">{t("members.filters.status")}</Label>
          <select
            id="membersStatusFilter"
            value={status}
            onChange={(e) => updateParams({ status: e.target.value, page: 1 })}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_LABEL_KEY[s])}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TablePagination compact page={page} pageSize={pageSize} total={total} {...pagination} />

      {initialMembers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          {total === 0 && !search && !status ? (
            <>
              <p className="text-sm text-muted-foreground">{t("members.emptyNoMembers")}</p>
              {canCreate && <Button onClick={openCreate}>{t("members.addMemberButton")}</Button>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("members.emptySearchNoMatch")}</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("members.table.name")}</th>
                <th className="p-3 font-medium">{t("members.table.phone")}</th>
                <th className="p-3 font-medium">{t("members.table.plan")}</th>
                <th className="p-3 font-medium">{t("members.table.status")}</th>
                <th className="p-3 font-medium">{t("members.table.expiry")}</th>
                <th className="p-3 font-medium">{t("members.table.lastCheckIn")}</th>
                <th className="p-3 font-medium">{t("members.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {initialMembers.map((member) => {
                const badge = STATUS_BADGE_CONFIG[resolveBadgeStatus(member)];
                const Icon = badge.icon;
                // Story 18.6. The list never fetches fee state per row: these
                // read the row's own settled-at and plan, and a fee-0 gym shows
                // nothing new (no awaiting rows exist there; collect, void and
                // assign are gated on a fee being configured).
                const feeAwaiting = isAwaitingRegistrationFee(member);
                const feeSettledNoPlan =
                  !member.deactivatedAt &&
                  member.registrationFeeSettledAt !== null &&
                  member.status === "no_active_plan" &&
                  registrationFee > 0;
                const showCollect = canCollectFee && feeAwaiting && registrationFee > 0;
                const showWaive = canManage && feeAwaiting;
                const showAssignPlan = canCreate && feeSettledNoPlan;
                const showVoid = canVoidFee && feeSettledNoPlan;
                return (
                  <tr
                    key={member.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                    onClick={() => openView(member)}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {member.name.slice(0, 1).toUpperCase()}
                        </div>
                        {member.name}
                      </div>
                    </td>
                    <td className="p-3">{member.phone ?? "—"}</td>
                    <td className="p-3">{member.planName ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={badge.className}>
                        <Icon size={12} className="mr-1" />
                        {t(badge.labelKey)}
                      </Badge>
                    </td>
                    <td className="p-3">{expiryLabel(member)}</td>
                    <td className="p-3 text-muted-foreground">{"—"}</td>
                    <td className="p-3">
                      {/* DropdownMenuContent renders through a Radix Portal outside this div's
                          DOM subtree -- this guard only works because React's synthetic events
                          bubble along the component tree, not the DOM tree. Do not remove this
                          as apparently-dead code. */}
                      <div onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={t("members.actions.menu", { name: member.name })}
                            >
                              {t("members.actions.button")}
                              <MoreVertical size={14} aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-blue-700 focus:text-blue-800"
                              onClick={() => openView(member)}
                            >
                              <Eye size={14} />
                              {t("members.actions.view")}
                            </DropdownMenuItem>
                            {canManage && (
                              <DropdownMenuItem
                                className="text-indigo-700 focus:text-indigo-800"
                                onClick={() => openEdit(member)}
                              >
                                <Pencil size={14} />
                                {t("members.actions.edit")}
                              </DropdownMenuItem>
                            )}
                            {canManage && !member.deactivatedAt && member.phone && (
                              <DropdownMenuItem
                                className="text-blue-700 focus:text-blue-800"
                                disabled={sendingInviteId === member.id || isAwaitingRegistrationFee(member)}
                                onClick={() => void handleSendInvite(member)}
                              >
                                <Send size={14} />
                                <span>
                                  {sendingInviteId === member.id
                                    ? t("members.invite.sending")
                                    : t("members.actions.invite")}
                                  {isAwaitingRegistrationFee(member) && (
                                    <span className="block text-xs font-normal text-muted-foreground">
                                      {t("members.invite.awaitingRegistrationFee")}
                                    </span>
                                  )}
                                </span>
                              </DropdownMenuItem>
                            )}
                            {showCollect && (
                              <DropdownMenuItem
                                className="text-green-700 focus:text-green-800"
                                onClick={() => setCollectingMember(member)}
                              >
                                <Banknote size={14} />
                                {t("members.actions.collectFee")}
                              </DropdownMenuItem>
                            )}
                            {showWaive && (
                              <DropdownMenuItem
                                className="text-amber-700 focus:text-amber-800"
                                onClick={() => setWaivingMember(member)}
                              >
                                <Gift size={14} />
                                {t("members.actions.waiveFee")}
                              </DropdownMenuItem>
                            )}
                            {showAssignPlan && (
                              <DropdownMenuItem
                                className="text-indigo-700 focus:text-indigo-800"
                                onClick={() => setAssigningMember(member)}
                              >
                                <UserPlus size={14} />
                                {t("members.actions.assignPlan")}
                              </DropdownMenuItem>
                            )}
                            {showVoid && (
                              <DropdownMenuItem
                                className="text-red-700 focus:text-red-800"
                                onClick={() => setVoidingMember(member)}
                              >
                                <Undo2 size={14} />
                                {t("members.actions.voidFee")}
                              </DropdownMenuItem>
                            )}
                            {canManage && !member.deactivatedAt && (
                              <DropdownMenuItem
                                className="text-red-700 focus:text-red-800"
                                onClick={() => setDeactivatingMember(member)}
                              >
                                <Ban size={14} />
                                {t("members.actions.deactivate")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TablePagination page={page} pageSize={pageSize} total={total} {...pagination} />

      {modalState && (
        <MemberModal
          open
          readOnly={modalState.readOnly}
          editingMember={modalState.member}
          plans={plans}
          coaches={coaches}
          registrationFee={registrationFee}
          onClose={() => setModalState(null)}
          onSaved={(warning, invite) => {
            setModalState(null);
            if (warning) showToast(warning);
            else if (invite === "sent") showToast(t("members.invite.createdSentToast"));
            else if (invite === "failed") showToast(t("members.invite.createdFailedToast"));
            router.refresh();
          }}
        />
      )}

      {deactivatingMember && (
        <DeactivateMemberDialog
          member={deactivatingMember}
          onClose={() => setDeactivatingMember(null)}
          onDone={(warning) => {
            setDeactivatingMember(null);
            if (warning) showToast(warning);
            router.refresh();
          }}
        />
      )}

      {collectingMember && (
        <CollectRegistrationFeeDialog
          member={collectingMember}
          registrationFee={registrationFee}
          mobileMoneyEnabled={mobileMoneyEnabled}
          onClose={() => setCollectingMember(null)}
          onCollected={() => {
            const member = collectingMember;
            const name = member.name;
            setCollectingMember(null);
            router.refresh();
            void sendAutoInvite(member).then((outcome) =>
              showToast(
                outcome === "sent"
                  ? t("members.feeCollect.collectedInviteSentToast", { name })
                  : outcome === "failed"
                    ? t("members.feeCollect.collectedInviteFailedToast", { name })
                    : t("members.feeCollect.collectedToast", { name }),
              ),
            );
          }}
        />
      )}

      {waivingMember && (
        <WaiveRegistrationFeeDialog
          member={waivingMember}
          onClose={() => setWaivingMember(null)}
          onDone={() => {
            const member = waivingMember;
            const name = member.name;
            setWaivingMember(null);
            router.refresh();
            void sendAutoInvite(member).then((outcome) =>
              showToast(
                outcome === "sent"
                  ? t("members.feeWaive.waivedInviteSentToast", { name })
                  : outcome === "failed"
                    ? t("members.feeWaive.waivedInviteFailedToast", { name })
                    : t("members.feeWaive.waivedToast", { name }),
              ),
            );
          }}
        />
      )}

      {voidingMember && (
        <VoidRegistrationFeeDialog
          member={voidingMember}
          onClose={() => setVoidingMember(null)}
          onDone={() => {
            const name = voidingMember.name;
            setVoidingMember(null);
            showToast(t("members.feeVoid.voidedToast", { name }));
            router.refresh();
          }}
        />
      )}

      {assigningMember && (
        <AssignInitialPlanDialog
          member={assigningMember}
          plans={plans}
          onClose={() => setAssigningMember(null)}
          onDone={(warning) => {
            const name = assigningMember.name;
            setAssigningMember(null);
            showToast(warning ?? t("members.assignPlan.assignedToast", { name }));
            router.refresh();
          }}
        />
      )}

      {invitingMember && (
        <InviteMemberModal
          member={invitingMember}
          gymName={gymName}
          onClose={() => setInvitingMember(null)}
        />
      )}

      {csvImportOpen && (
        <CsvImportModal
          onClose={() => setCsvImportOpen(false)}
          phoneCountry={phoneCountry}
          onImported={(count, warning) => {
            setCsvImportOpen(false);
            showToast(warning ?? t("members.csvImport.importSuccessToast", { count }));
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 max-w-sm rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
