"use client";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { TablePagination } from "@/components/TablePagination";
import { useUrlPagination } from "@/hooks/use-table-pagination";
import type { GymMemberPage } from "@/services/gyms";

const ROLE_LABEL_KEY: Record<string, string> = {
  member: "gyms.memberRecords.role.member",
  coach: "gyms.memberRecords.role.coach",
  receptionist: "gyms.memberRecords.role.receptionist",
  manager: "gyms.memberRecords.role.manager",
  owner: "gyms.memberRecords.role.owner",
  supervisor: "gyms.memberRecords.role.supervisor",
};

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
  // Own page/size params so the other table on this route keeps its position.
  const pagination = useUrlPagination({ pageParam: "mpage", sizeParam: "msize" });

  if (members === null) {
    return null;
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
          <Button variant="outline" size="sm" onClick={() => pagination.onPageChange(1)}>
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
          <TablePagination
            page={members.page}
            pageSize={members.pageSize}
            total={members.total}
            onPageChange={pagination.onPageChange}
            onPageSizeChange={pagination.onPageSizeChange}
          />
        </>
      )}
    </div>
  );
}
