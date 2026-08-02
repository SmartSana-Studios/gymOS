"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowUp, ArrowDown, Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CoachPortalMemberRow } from "@/services/coaches";
import { PLAN_TYPE_LABEL_KEY } from "@/app/(dashboard)/plans/planLabels";
import { STATUS_BADGE_CONFIG } from "@/app/(dashboard)/subscriptions/subscriptionLabels";

// Union of AC #2 ("sortable by name and plan") and the AD-14 mockup
// ("Name / Status / Expiry") -- same click-to-sort header mechanism
// SubscriptionsPageClient.tsx already established, minus pagination/CSV
// export/filter dropdowns (no AC/mockup calls for any of those here).
const SORT_COLUMNS = [
  { key: "name", labelKey: "coachPortal.table.name" },
  { key: "plan", labelKey: "coachPortal.table.plan" },
  { key: "status", labelKey: "coachPortal.table.status" },
  { key: "expiry", labelKey: "coachPortal.table.expiry" },
] as const;

// MembersPageClient.tsx's exact local-date-parsing pattern -- avoids the
// UTC-shift bug from parsing a "YYYY-MM-DD" string via `new Date(string)`
// directly. Per-file copy, not a cross-import (this app's own convention).
function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

export function CoachPortalPageClient({
  members,
  search,
  sort,
  dir,
}: {
  members: CoachPortalMemberRow[];
  search: string;
  sort: string;
  dir: string;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchInput, setSearchInput] = useState(search);

  // Keeps the input in sync with the URL param on external navigation
  // (e.g. browser back/forward) -- matches MembersPageClient's established
  // precedent.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(search);
  }, [search]);

  // 300ms debounce -- MembersPageClient.tsx's own established precedent for
  // its name/phone search input, reused verbatim rather than a new number.
  useEffect(() => {
    if (searchInput === search) return;
    const handle = setTimeout(() => {
      updateParams({ search: searchInput });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function updateParams(next: { search?: string; sort?: string; dir?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.search !== undefined) {
      if (next.search) params.set("search", next.search);
      else params.delete("search");
    }
    if (next.sort !== undefined) params.set("sort", next.sort);
    if (next.dir !== undefined) params.set("dir", next.dir);
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleSort(column: string) {
    if (sort === column) {
      updateParams({ sort: column, dir: dir === "asc" ? "desc" : "asc" });
    } else {
      updateParams({ sort: column, dir: "asc" });
    }
  }

  function expiryLabel(row: CoachPortalMemberRow): string {
    if (!row.expiryDate) return "—";
    return formatLocalDate(row.expiryDate, i18n.language);
  }

  function planTypeLabel(row: CoachPortalMemberRow): string {
    const key = PLAN_TYPE_LABEL_KEY[row.planType as keyof typeof PLAN_TYPE_LABEL_KEY];
    return key ? t(key) : row.planType;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("coachPortal.title")}</h1>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder={t("coachPortal.searchPlaceholder")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {members.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          {search.trim() ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("coachPortal.emptySearchNoMatch", { term: search })}
              </p>
              <Button variant="outline" size="sm" onClick={() => setSearchInput("")}>
                {t("coachPortal.clearSearch")}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("coachPortal.emptyNoAssignments")}</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                {SORT_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="p-3 font-medium"
                    aria-sort={sort === col.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      {t(col.labelKey)}
                      {sort === col.key && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </th>
                ))}
                <th className="p-3 font-medium">{t("coachPortal.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((row) => {
                const badge = STATUS_BADGE_CONFIG[row.status] ?? STATUS_BADGE_CONFIG.active;
                const Icon = badge.icon;
                return (
                  // No page-to-page row-click precedent existed in this app
                  // before this story (MembersPageClient's own row onClick
                  // opens an in-page modal, not a route change) -- keeps
                  // MembersPageClient's cursor-pointer/hover affordance.
                  // tabIndex/onKeyDown/role give keyboard and screen-reader
                  // users the same navigation the row's onClick and the
                  // "View" button already give mouse users (code review
                  // finding, story 5.3).
                  <tr
                    key={row.memberId}
                    onClick={() => router.push(`/coach/${row.memberId}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") router.push(`/coach/${row.memberId}`);
                    }}
                    tabIndex={0}
                    role="link"
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {row.memberName.slice(0, 1).toUpperCase()}
                        </div>
                        {row.memberName}
                      </div>
                    </td>
                    <td className="p-3">{planTypeLabel(row)}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={badge.className}>
                        <Icon size={12} className="mr-1" />
                        {t(badge.labelKey)}
                      </Badge>
                    </td>
                    <td className="p-3">{expiryLabel(row)}</td>
                    <td className="p-3">
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                          onClick={() => router.push(`/coach/${row.memberId}`)}
                        >
                          <Eye size={14} />
                          {t("coachPortal.actions.view")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
