"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AttendanceLogRow, CurrentlyCheckedInRow } from "@/services/attendance";
import { resolveBadgeStatus, STATUS_BADGE_CONFIG } from "../attendanceLabels";
import { CheckOutMemberConfirmDialog } from "./CheckOutMemberConfirmDialog";

// Windows the page-number buttons around the current page, copied verbatim
// from MembersPageClient's own pageWindow (per-file copy, no cross-route
// import, matching this app's established discipline for shared UI logic
// with no services/ home).
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
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isRefreshing, startRefreshTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(memberSearch);
  const [checkingOutMember, setCheckingOutMember] = useState<CurrentlyCheckedInRow | null>(null);

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

  const totalPages = Math.max(1, Math.ceil(logTotal / pageSize));
  const checkedInTotalPages = Math.max(1, Math.ceil(checkedInTotal / checkedInPageSize));

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">{t("attendance.title")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium">
            {t("attendance.checkedInHeading", { count: checkedInTotal })}
          </h2>
          <span className="text-sm text-muted-foreground">
            {t("attendance.todayCount", { count: todayCount })}
          </span>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            {t("attendance.refresh")}
          </Button>
        </div>

        {currentlyCheckedIn.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">{t("attendance.emptyCheckedIn")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("attendance.table.member")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.checkIn")}</th>
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
                      <td className="p-3">
                        <Badge variant="outline" className={badge.className}>
                          <Icon size={12} className="mr-1" />
                          {t(badge.labelKey)}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Button variant="outline" size="sm" onClick={() => setCheckingOutMember(row)}>
                          {t("attendance.checkOutButton")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {checkedInTotalPages > 1 && (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label={t("attendance.pagination.previous")}
              disabled={checkedInPage <= 1}
              onClick={() => updateParams({ checkedInPage: checkedInPage - 1 })}
            >
              <ChevronLeft size={16} />
            </Button>
            {pageWindow(checkedInPage, checkedInTotalPages).map((p, i) =>
              p === "ellipsis" ? (
                <span key={`checkedin-ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">
                  {t("attendance.pagination.ellipsis")}
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === checkedInPage ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateParams({ checkedInPage: p })}
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              aria-label={t("attendance.pagination.next")}
              disabled={checkedInPage >= checkedInTotalPages}
              onClick={() => updateParams({ checkedInPage: checkedInPage + 1 })}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
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

        {logRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">{t("attendance.emptyLog")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("attendance.table.member")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.checkIn")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.checkOut")}</th>
                  <th className="p-3 font-medium">{t("attendance.table.duration")}</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-3">{memberDisplayName(row.memberName)}</td>
                    <td className="p-3">{formatTimestamp(row.checkedInAt)}</td>
                    <td className="p-3">{row.checkedOutAt ? formatTimestamp(row.checkedOutAt) : "—"}</td>
                    <td className="p-3">{formatDuration(row.checkedInAt, row.checkedOutAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label={t("attendance.pagination.previous")}
              disabled={page <= 1}
              onClick={() => updateParams({ from, to, memberSearch, page: page - 1 })}
            >
              <ChevronLeft size={16} />
            </Button>
            {pageWindow(page, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">
                  {t("attendance.pagination.ellipsis")}
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateParams({ from, to, memberSearch, page: p })}
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              aria-label={t("attendance.pagination.next")}
              disabled={page >= totalPages}
              onClick={() => updateParams({ from, to, memberSearch, page: page + 1 })}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </div>

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
