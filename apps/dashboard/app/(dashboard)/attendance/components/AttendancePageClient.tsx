"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { LogOut, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TablePagination } from "@/components/TablePagination";
import { useUrlPagination } from "@/hooks/use-table-pagination";
import type { AttendanceEntryInfo, AttendanceLogRow, CurrentlyCheckedInRow } from "@/services/attendance";
import type { FrontDeskAlertRow } from "@/services/frontDeskAlerts";
import { FrontDeskAlertPanel } from "@/components/shared/FrontDeskAlertPanel";
import { resolveBadgeStatus, STATUS_BADGE_CONFIG } from "../attendanceLabels";
import { CheckOutMemberConfirmDialog } from "./CheckOutMemberConfirmDialog";
import { CheckInMemberModal } from "./CheckInMemberModal";
import { VoidCheckInModal, type VoidTarget } from "./VoidCheckInModal";

/** Story 27.3: who may check a member in at the entrance (every role that sees this page, and GymOS Support). Coach has no Attendance. */
const CHECK_IN_ROLES = ["receptionist", "manager", "supervisor", "owner", "support"];
/** Who may void a staff entry the same day (Manager and above, and GymOS Support). The database re-checks the role. */
const VOID_ROLES = ["manager", "supervisor", "owner", "support"];

export const ATTENDANCE_TABS = ["checkedIn", "log"] as const;
type AttendanceTab = (typeof ATTENDANCE_TABS)[number];

function parseTab(value: string | null | undefined): AttendanceTab {
  return (ATTENDANCE_TABS as readonly string[]).includes(value ?? "") ? (value as AttendanceTab) : "checkedIn";
}

export function AttendancePageClient({
  currentlyCheckedIn,
  checkedInTotal,
  checkedInPage,
  checkedInPageSize,
  todayCount,
  logRows,
  logTotal,
  page,
  pageSize,
  from,
  to,
  memberSearch,
  gymId,
  initialAlerts,
  autoDismissMinutes,
  mobileMoneyEnabled,
  role,
}: {
  currentlyCheckedIn: CurrentlyCheckedInRow[];
  checkedInTotal: number;
  checkedInPage: number;
  checkedInPageSize: number;
  todayCount: number;
  logRows: AttendanceLogRow[];
  logTotal: number;
  page: number;
  pageSize: number;
  from: string;
  to: string;
  memberSearch: string;
  gymId: string;
  initialAlerts: FrontDeskAlertRow[];
  autoDismissMinutes: number;
  /** Story 4.12 (AC #4): threaded straight through to `FrontDeskAlertPanel`. */
  mobileMoneyEnabled: boolean;
  /** Story 19.9b: the signed-in staff role, threaded to the alert panel. */
  role?: string;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const checkedInPagination = useUrlPagination({ pageParam: "checkedInPage", sizeParam: "checkedInSize" });
  const logPagination = useUrlPagination();
  const [tab, setTab] = useState<AttendanceTab>(parseTab(searchParams?.get("tab")));
  const [isRefreshing, startRefreshTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(memberSearch);
  const [checkingOutMember, setCheckingOutMember] = useState<CurrentlyCheckedInRow | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canCheckIn = role !== undefined && CHECK_IN_ROLES.includes(role);
  const canVoid = role !== undefined && VOID_ROLES.includes(role);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  // Review Finding: `updateParams` used to close over `searchParams`
  // directly, so a debounce timeout scheduled on one render could fire
  // after a later render's date-filter change and silently revert it with
  // the stale param snapshot it captured at scheduling time. A ref always
  // reflects the latest value regardless of which render's closure reads it.
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  // Resync when the URL's `memberSearch` param changes externally (browser
  // back/forward) -- matches MembersPageClient's established precedent.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(memberSearch);
  }, [memberSearch]);

  // Matches MembersPageClient's own 300ms debounce pattern for live search.
  useEffect(() => {
    if (searchInput === memberSearch) return;
    const handle = setTimeout(() => {
      updateParams({ memberSearch: searchInput, page: 1 });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function updateParams(next: {
    from?: string;
    to?: string;
    memberSearch?: string;
    page?: number;
    checkedInPage?: number;
  }) {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (next.from !== undefined) params.set("from", next.from);
    if (next.to !== undefined) params.set("to", next.to);
    if (next.memberSearch !== undefined) {
      if (next.memberSearch) params.set("memberSearch", next.memberSearch);
      else params.delete("memberSearch");
    }
    if (next.checkedInPage !== undefined) {
      // The Currently Checked-In table has no date/search filters of its
      // own, so its pagination is independent -- only touch it when a
      // caller explicitly asks, never reset it as a side effect of a Daily
      // Log filter change.
      params.set("checkedInPage", String(next.checkedInPage));
    }
    if (next.from !== undefined || next.to !== undefined || next.memberSearch !== undefined || next.page !== undefined) {
      params.set("page", String(next.page ?? 1));
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function selectTab(value: string) {
    const next = parseTab(value);
    setTab(next);
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Review Finding: a fixed setTimeout doesn't reflect whether
  // router.refresh()'s real server round trip actually completed.
  // useTransition's isPending stays true until the refreshed Server
  // Component data resolves -- the idiomatic App Router pattern for this.
  function handleRefresh() {
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  // Full timestamps never need the locale-safe date-only parsing
  // MembersPageClient.expiryLabel uses for date-only strings (no UTC-shift
  // risk here -- `new Date(isoTimestamp)` already carries real time-of-day
  // information, not just a calendar date).
  function formatTimestamp(iso: string): string {
    return new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
  }

  // Review Finding: this previously built an untranslated "{h}h {m}m"
  // string directly, the one hardcoded piece of UI text on an otherwise
  // fully-translated page (FR-016, CI-enforced per this story's own Dev
  // Notes). Routed through i18n like everything else here.
  function formatDuration(checkedInAt: string, checkedOutAt: string | null): string {
    if (!checkedOutAt) return t("attendance.durationOpen");
    const ms = new Date(checkedOutAt).getTime() - new Date(checkedInAt).getTime();
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return t("attendance.durationFormat", { hours, minutes });
  }

  // Review Finding: a null join previously rendered as a blank name cell
  // with no way to tell it apart from a real (impossible, but silent)
  // empty name.
  function memberDisplayName(name: string): string {
    return name || t("attendance.unknownMember");
  }

  // Story 27.3 (UX AD-11 V1.8): the Entry cell is plain text, never colour-coded. A scan (and every row from before V1.8) reads "QR scan";
  // a staff entry shows the neutral "By staff" pill and "· [Name]" -- the name is hidden under 1024 px, the pill always stays. A name
  // that did not resolve leaves the pill alone and the row stays usable.
  function entryCell(entry: AttendanceEntryInfo) {
    if (entry.source !== "staff") return t("attendance.log.entryScan");
    return (
      <span className="inline-flex items-center gap-1">
        {/* The screen-reader text is a real node: the visible name is display:none under 1024 px, and aria-label on a plain span is ignored. */}
        <span className="sr-only">{entry.enteredByLabel ? t("attendance.log.entryAria", { name: entry.enteredByLabel }) : t("attendance.log.byStaff")}</span>
        <Badge aria-hidden="true" variant="outline" className="border-gray-200 bg-gray-100 text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
          <UserCheck size={12} className="mr-1" aria-hidden="true" />
          {t("attendance.log.byStaff")}
        </Badge>
        {entry.enteredByLabel && (
          <span aria-hidden="true" className="hidden lg:inline">
            · {entry.enteredByLabel}
          </span>
        )}
      </span>
    );
  }

  function voidedDetail(row: AttendanceLogRow): string {
    const when = row.voidedAt ? new Date(row.voidedAt) : null;
    return t("attendance.log.voidedDetail", {
      name: row.voidedByLabel ?? "",
      date: when ? when.toLocaleDateString(i18n.language) : "",
      time: when ? when.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false }) : "",
      reason: row.voidReason ?? "",
    });
  }

  function voidTimeLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function voidButton(row: { id: string; memberName: string; checkedInAt: string; consumedSession: boolean | null; consumedSessionPaid: boolean | null; earnedStamp: boolean | null }) {
    const name = memberDisplayName(row.memberName);
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={t("attendance.void.actionAria", { name, time: voidTimeLabel(row.checkedInAt) })}
        onClick={() =>
          setVoidTarget({
            attendanceId: row.id,
            memberName: name,
            checkedInAt: row.checkedInAt,
            consumedSession: row.consumedSession,
            consumedSessionPaid: row.consumedSessionPaid,
            earnedStamp: row.earnedStamp,
          })
        }
      >
        {t("attendance.void.action")}
      </Button>
    );
  }


  return (
    <div className="space-y-8">
      <FrontDeskAlertPanel
        gymId={gymId}
        initialAlerts={initialAlerts}
        autoDismissMinutes={autoDismissMinutes}
        mobileMoneyEnabled={mobileMoneyEnabled}
        role={role}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("attendance.title")}</h1>
        {/* Absent from the DOM for a Coach (and any role without the check-in), not just disabled. */}
        {canCheckIn && (
          <Button onClick={() => setCheckInOpen(true)}>
            <UserCheck size={16} />
            {t("attendance.checkIn.action")}
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-4 bg-card">
          <p className="text-sm text-muted-foreground">{t("attendance.summary.checkedIn")}</p>
          <p className="text-2xl font-semibold">{checkedInTotal.toLocaleString(i18n.language)}</p>
        </div>
        <div className="rounded-md border p-4 bg-card">
          <p className="text-sm text-muted-foreground">{t("attendance.summary.today")}</p>
          <p className="text-2xl font-semibold">{todayCount.toLocaleString(i18n.language)}</p>
        </div>
        <div className="rounded-md border p-4 bg-card">
          <p className="text-sm text-muted-foreground">{t("attendance.summary.alerts")}</p>
          <p className="text-2xl font-semibold">{initialAlerts.length.toLocaleString(i18n.language)}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="checkedIn">{t("attendance.tabs.checkedIn", { count: checkedInTotal })}</TabsTrigger>
          <TabsTrigger value="log">{t("attendance.tabs.log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="checkedIn" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            {t("attendance.refresh")}
          </Button>
        </div>

        <TablePagination compact
          page={checkedInPage}
          pageSize={checkedInPageSize}
          total={checkedInTotal}
          {...checkedInPagination}
        />

        {currentlyCheckedIn.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">{t("attendance.emptyCheckedIn")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("attendance.table.member")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.checkIn")}</th>
                  <th className="p-3 font-medium">{t("attendance.log.entry")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.status")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {currentlyCheckedIn.map((row) => {
                  const badge = STATUS_BADGE_CONFIG[resolveBadgeStatus(row)];
                  const Icon = badge.icon;
                  return (
                    <tr key={row.memberId} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                            {memberDisplayName(row.name).slice(0, 1).toUpperCase()}
                          </div>
                          {memberDisplayName(row.name)}
                        </div>
                      </td>
                      <td className="p-3">{formatTimestamp(row.checkedInAt)}</td>
                      <td className="p-3">{entryCell(row)}</td>
                      <td className="p-3">
                        <Badge variant="outline" className={badge.className}>
                          <Icon size={12} className="mr-1" />
                          {t(badge.labelKey)}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950 dark:hover:text-blue-200"
                            onClick={() => setCheckingOutMember(row)}
                          >
                            <LogOut size={14} />
                            {t("attendance.checkOutButton")}
                          </Button>
                          {/* Only a staff entry of today, not voided, and only for Manager and above: otherwise absent from the DOM. */}
                          {canVoid &&
                            row.voidable &&
                            voidButton({
                              id: row.attendanceId,
                              memberName: row.name,
                              checkedInAt: row.checkedInAt,
                              consumedSession: row.consumedSession,
                              consumedSessionPaid: row.consumedSessionPaid,
                              earnedStamp: row.earnedStamp,
                            })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <TablePagination
          page={checkedInPage}
          pageSize={checkedInPageSize}
          total={checkedInTotal}
          {...checkedInPagination}
        />
        </TabsContent>
        <TabsContent value="log" className="space-y-4">
        <h2 className="text-lg font-medium">{t("attendance.dailyLogHeading")}</h2>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="attendanceFrom" className="text-sm text-muted-foreground">
              {t("attendance.dateFrom")}
            </label>
            <input
              id="attendanceFrom"
              type="date"
              value={from}
              // Review Finding: clearing a native date input emits "", not
              // undefined -- fall back to the current known-good value
              // instead of pushing an empty string as the URL param.
              onChange={(e) => updateParams({ from: e.target.value || from, to, page: 1 })}
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="attendanceTo" className="text-sm text-muted-foreground">
              {t("attendance.dateTo")}
            </label>
            <input
              id="attendanceTo"
              type="date"
              value={to}
              onChange={(e) => updateParams({ from, to: e.target.value || to, page: 1 })}
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <Input
            placeholder={t("attendance.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-xs"
          />
        </div>

        <TablePagination compact page={page} pageSize={pageSize} total={logTotal} {...logPagination} />

        {logRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">{t("attendance.emptyLog")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("attendance.table.member")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.checkIn")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.checkOut")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.duration")}</th>
                  <th className="p-3 font-medium">{t("attendance.log.entry")}</th>
                  {canVoid && (
                    <th className="p-3 font-medium">
                      <span className="sr-only">{t("attendance.table.actions")}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {logRows.map((row) => {
                  const voided = row.voidedAt !== null;
                  return (
                    <tr key={row.id} className={`border-b last:border-0 ${voided ? "text-muted-foreground" : ""}`} data-voided={voided ? "true" : undefined}>
                      <td className="p-3">{memberDisplayName(row.memberName)}</td>
                      <td className="p-3">{formatTimestamp(row.checkedInAt)}</td>
                      <td className="p-3">
                        {voided ? (
                          // The "Voided" pill sits in the Check-out cell; the tooltip and the screen-reader text say who, when and why.
                          <span title={voidedDetail(row)}>
                            <Badge variant="outline" className="border-gray-200 bg-gray-100 text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                              {t("attendance.log.voided")}
                            </Badge>
                            <span className="sr-only">{voidedDetail(row)}</span>
                          </span>
                        ) : row.checkedOutAt ? (
                          formatTimestamp(row.checkedOutAt)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3">{voided ? "—" : formatDuration(row.checkedInAt, row.checkedOutAt)}</td>
                      <td className="p-3">{entryCell(row)}</td>
                      {canVoid && (
                        <td className="p-3">
                          {row.voidable &&
                            voidButton({
                              id: row.id,
                              memberName: row.memberName,
                              checkedInAt: row.checkedInAt,
                              consumedSession: row.consumedSession,
                              consumedSessionPaid: row.consumedSessionPaid,
                              earnedStamp: row.earnedStamp,
                            })}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <TablePagination page={page} pageSize={pageSize} total={logTotal} {...logPagination} />
        </TabsContent>
      </Tabs>

      {checkInOpen && (
        <CheckInMemberModal
          role={role}
          mobileMoneyEnabled={mobileMoneyEnabled}
          onClose={() => {
            setCheckInOpen(false);
            router.refresh();
          }}
          onChanged={() => router.refresh()}
        />
      )}

      {voidTarget && (
        <VoidCheckInModal
          target={voidTarget}
          isSupport={role === "support"}
          onClose={() => setVoidTarget(null)}
          onStale={() => router.refresh()}
          onVoided={() => {
            const name = voidTarget.memberName;
            setVoidTarget(null);
            showToast(t("attendance.void.success", { name }));
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 max-w-sm rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg">
          {toast}
        </div>
      )}

      {checkingOutMember && (
        <CheckOutMemberConfirmDialog
          memberId={checkingOutMember.memberId}
          memberName={checkingOutMember.name}
          onClose={() => setCheckingOutMember(null)}
          onDone={() => {
            setCheckingOutMember(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
