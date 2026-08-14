"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Eye, Pencil, Send, Ban } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberListRow } from "@/services/members";
import type { PlanRow } from "@/services/plans";
import type { CoachRow } from "@/services/coaches";
import type { MemberRole } from "@/services/session";
import { exportMembersCsv, sendMemberInvite } from "../actions";
import { resolveBadgeStatus, STATUS_BADGE_CONFIG } from "../memberLabels";
import { MemberModal } from "./MemberModal";
import { DeactivateMemberDialog } from "./DeactivateMemberDialog";
import { CsvImportModal } from "./CsvImportModal";
import { InviteMemberModal } from "./InviteMemberModal";

const STATUS_OPTIONS = ["", "active", "expiring_soon", "grace_period", "expired", "deactivated"] as const;
const STATUS_LABEL_KEY: Record<(typeof STATUS_OPTIONS)[number], string> = {
  "": "members.statusAll",
  active: "members.status.active",
  expiring_soon: "members.status.expiringSoon",
  grace_period: "members.status.gracePeriod",
  expired: "members.status.expired",
  deactivated: "members.status.deactivated",
};

const CAN_MANAGE: MemberRole[] = ["manager", "owner"];

// Windows the page-number buttons around the current page (always keeping
// the first/last page visible) instead of rendering one button per page --
// unbounded-cap gyms with hundreds of members would otherwise produce
// hundreds of buttons.
const PAGE_WINDOW_RADIUS = 2;

function pageWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 1) return total === 1 ? [1] : [];

  const middle: number[] = [];
  for (
    let p = Math.max(2, current - PAGE_WINDOW_RADIUS);
    p <= Math.min(total - 1, current + PAGE_WINDOW_RADIUS);
    p++
  ) {
    middle.push(p);
  }

  const result: (number | "ellipsis")[] = [1];
  if (middle[0] > 2) result.push("ellipsis");
  result.push(...middle);
  if (middle[middle.length - 1] < total - 1) result.push("ellipsis");
  result.push(total);
  return result;
}

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
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canManage = CAN_MANAGE.includes(role);

  const [searchInput, setSearchInput] = useState(search);
  const [modalState, setModalState] = useState<{ member: MemberListRow | null; readOnly: boolean } | null>(null);
  const [deactivatingMember, setDeactivatingMember] = useState<MemberListRow | null>(null);
  const [invitingMember, setInvitingMember] = useState<MemberListRow | null>(null);
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
  async function handleSendInvite(member: MemberListRow) {
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
          {canManage && <Button onClick={openCreate}>{t("members.addMember")}</Button>}
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

      {initialMembers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          {total === 0 && !search && !status ? (
            <>
              <p className="text-sm text-muted-foreground">{t("members.emptyNoMembers")}</p>
              {canManage && <Button onClick={openCreate}>{t("members.addMemberButton")}</Button>}
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
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                          onClick={() => openView(member)}
                        >
                          <Eye size={14} />
                          {t("members.actions.view")}
                        </Button>
                        {canManage && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800"
                            onClick={() => openEdit(member)}
                          >
                            <Pencil size={14} />
                            {t("members.actions.edit")}
                          </Button>
                        )}
                        {canManage && !member.deactivatedAt && member.phone && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                            disabled={sendingInviteId === member.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSendInvite(member);
                            }}
                          >
                            <Send size={14} />
                            {sendingInviteId === member.id
                              ? t("members.invite.sending")
                              : t("members.actions.invite")}
                          </Button>
                        )}
                        {canManage && !member.deactivatedAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                            onClick={() => setDeactivatingMember(member)}
                          >
                            <Ban size={14} />
                            {t("members.actions.deactivate")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("members.pagination.previous")}
            disabled={page <= 1}
            onClick={() => updateParams({ page: page - 1 })}
          >
            <ChevronLeft size={16} />
          </Button>
          {pageWindow(page, totalPages).map((p, i) =>
            p === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">
                {t("members.pagination.ellipsis")}
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                onClick={() => updateParams({ page: p })}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="outline"
            size="sm"
            aria-label={t("members.pagination.next")}
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: page + 1 })}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      {modalState && (
        <MemberModal
          open
          readOnly={modalState.readOnly}
          editingMember={modalState.member}
          plans={plans}
          coaches={coaches}
          onClose={() => setModalState(null)}
          onSaved={(warning) => {
            setModalState(null);
            if (warning) showToast(warning);
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
