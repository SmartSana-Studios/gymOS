"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CurrentlyCheckedInRow } from "@/services/attendance";
import { CheckOutMemberConfirmDialog } from "@/app/(dashboard)/attendance/components/CheckOutMemberConfirmDialog";
import { CHECKED_IN_STATUS_BADGE_CONFIG, resolveCheckedInBadgeStatus } from "../overviewLabels";

/**
 * Story 17.1 (AD-02 Currently Checked-In table). A client component because
 * it carries the Check Out action. `rows` arrive already capped at 10 by the
 * page and in `getCurrentlyCheckedIn()`'s own check-in-time-ascending order,
 * which is AD-02's order -- never re-sorted here. Check Out reuses
 * attendance's own dialog and `checkingOutMember` state pattern
 * (AttendancePageClient.tsx) rather than a second check-out path.
 */
export function CheckedInTable({ rows, loadError }: { rows: CurrentlyCheckedInRow[]; loadError: boolean }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [checkingOutMember, setCheckingOutMember] = useState<CurrentlyCheckedInRow | null>(null);

  // Full timestamps carry a real time of day, so `new Date(iso)` is safe here
  // (unlike date-only strings). Explicit locale, never bare toLocaleString().
  function formatTimestamp(iso: string): string {
    return new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
  }

  function memberDisplayName(name: string): string {
    return name || t("attendance.unknownMember");
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{t("overview.tables.checkedIn.title")}</h2>
        <Link href="/attendance" className="text-sm text-muted-foreground hover:text-foreground">
          {t("overview.tables.viewAll")}
        </Link>
      </div>

      {loadError ? (
        <p className="text-sm text-red-600">{t("common.loadError")}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("attendance.emptyCheckedIn")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("overview.tables.checkedIn.name")}</th>
                <th className="p-3 font-medium">{t("overview.tables.checkedIn.checkInTime")}</th>
                <th className="p-3 font-medium">{t("overview.tables.checkedIn.status")}</th>
                <th className="p-3 font-medium">{t("overview.tables.checkedIn.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = CHECKED_IN_STATUS_BADGE_CONFIG[resolveCheckedInBadgeStatus(row)];
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
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                        onClick={() => setCheckingOutMember(row)}
                      >
                        <LogOut size={14} />
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
    </section>
  );
}
