"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GymMemberPage } from "@/services/gyms";

const ROLE_LABEL_KEY: Record<string, string> = {
  member: "gyms.memberRecords.role.member",
  coach: "gyms.memberRecords.role.coach",
  receptionist: "gyms.memberRecords.role.receptionist",
  manager: "gyms.memberRecords.role.manager",
  owner: "gyms.memberRecords.role.owner",
  supervisor: "gyms.memberRecords.role.supervisor",
};

// Cap on the numbered pager buttons -- a gym with thousands of members
// (or payments, in the sibling table) would otherwise render one button per
// page. GymsPageClient's own `Array.from({ length: totalPages })` is only
// safe at gym-list scale (dozens of gyms, not tens of thousands of member
// rows) and is not copied here.
const MAX_PAGE_BUTTONS = 7;

function pageButtonRange(current: number, total: number): number[] {
  if (total <= MAX_PAGE_BUTTONS) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const half = Math.floor(MAX_PAGE_BUTTONS / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(total, start + MAX_PAGE_BUTTONS - 1);
  start = Math.max(1, end - MAX_PAGE_BUTTONS + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * Story 1.14 AC #2: read-only member records, visible only once escalated.
 * `members === null` means "not escalated" (Task 2's page.tsx contract) and
 * renders nothing at all -- same posture as ActiveAccessList returning null
 * on an empty list, and as AuditTrailTab always rendering its container
 * regardless (this one does NOT always render, since "not escalated" is a
 * materially different state from "escalated but zero members," which is
 * why the empty-state copy below is distinct from simply not rendering).
 *
 * Container matches AuditTrailTab.tsx exactly: an always-visible bordered
 * section, not a tab-switcher -- there is still no Tabs primitive in
 * components/ui/.
 */
export function GymMembersTable({ members }: { members: GymMemberPage | null }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  if (members === null) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(members.total / members.pageSize));

  // Preserves the OTHER table's own page param (`ppage`) when this one's
  // page changes -- two independent tables on one route must not reset each
  // other's position.
  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mpage", String(page));
    router.push(`?${params.toString()}`);
  }

  // `joinDate` is a date-only column ("YYYY-MM-DD", no time component).
  // `new Date(dateOnly)` parses it as UTC midnight, which renders a day
  // early in any timezone west of UTC -- build the Date from local Y/M/D
  // components instead, matching this codebase's established
  // formatLocalDate pattern (e.g. RenewalModal.tsx, SettingsForm.tsx).
  function formatJoinDate(dateOnly: string): string {
    const [year, month, day] = dateOnly.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(i18n.language);
  }

  return (
    <div className="space-y-3 rounded-md border p-6">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {t("gyms.memberRecords.title")}
      </h2>

      {members.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t("gyms.memberRecords.empty")}</p>
      ) : members.rows.length === 0 ? (
        // total > 0 but this page has no rows -- a stale mpage param past
        // the last page (e.g. after a member count shrank), not "no
        // members." Same distinction GymsPageClient.tsx:170-190 makes.
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t("gyms.memberRecords.emptyPage")}</p>
          <Button variant="outline" size="sm" onClick={() => goToPage(1)}>
            {t("gyms.backToPage1")}
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.memberRecords.columns.name")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.memberRecords.columns.phone")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.memberRecords.columns.role")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.memberRecords.columns.joined")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.memberRecords.columns.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.rows.map((member) => (
                  <tr key={member.id} className="border-b last:border-0">
                    <td className="p-3">{member.name}</td>
                    <td className="p-3">{member.phone ?? "—"}</td>
                    <td className="p-3">
                      {ROLE_LABEL_KEY[member.role] ? t(ROLE_LABEL_KEY[member.role]) : member.role}
                    </td>
                    <td className="p-3">{formatJoinDate(member.joinDate)}</td>
                    <td className="p-3">
                      {member.deactivatedAt === null
                        ? t("gyms.memberRecords.status.active")
                        : t("gyms.memberRecords.status.deactivated")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={t("gyms.pagination.previous")}
                disabled={members.page <= 1}
                onClick={() => goToPage(members.page - 1)}
              >
                <ChevronLeft size={16} />
              </Button>
              {pageButtonRange(members.page, totalPages).map((p) => (
                <Button
                  key={p}
                  variant={p === members.page ? "default" : "outline"}
                  size="sm"
                  onClick={() => goToPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                aria-label={t("gyms.pagination.next")}
                disabled={members.page >= totalPages}
                onClick={() => goToPage(members.page + 1)}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
