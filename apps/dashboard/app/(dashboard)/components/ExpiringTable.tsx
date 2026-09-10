"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RenewalModal } from "@/components/shared/RenewalModal";
import type { SubscriptionListRow } from "@/services/subscriptions";
import { EXPIRING_STATUS_BADGE_CONFIG } from "../overviewLabels";

// SubscriptionsPageClient.tsx's exact local-date-parsing pattern -- a bare
// `new Date("2026-09-30")` parses as UTC midnight and renders a day early for
// a negative-UTC-offset viewer.
function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

/**
 * Story 17.1 (AD-02 Expiring This Week table). A client component because it
 * carries the Renew action. `rows` arrive already capped at 10 by the page,
 * soonest expiry first, from the same
 * `listSubscriptions({ status: "expiring_soon", sort: "expiry" })` call whose
 * `total` feeds the "Expiring this week" card. "View all" carries the same
 * sort, so the full list continues in the order the table started. Renew reuses the standalone
 * RenewalModal exactly as SubscriptionsPageClient does -- no second renewal
 * path.
 */
export function ExpiringTable({
  rows,
  loadError,
  mobileMoneyEnabled,
}: {
  rows: SubscriptionListRow[];
  loadError: boolean;
  /** Threaded straight through to `RenewalModal`, as on the Subscriptions page. */
  mobileMoneyEnabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [renewingRow, setRenewingRow] = useState<SubscriptionListRow | null>(null);

  // A stable identity for `onRenewed` -- RenewalModal's mobile-money
  // pending-payment watch lists it as an effect dependency, so a fresh arrow
  // each render would tear down that payment-status subscription (Story 4.12
  // review finding, FrontDeskAlertPanel.tsx). `router` is itself stable.
  const handleRenewed = useCallback(() => {
    setRenewingRow(null);
    router.refresh();
  }, [router]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{t("overview.tables.expiring.title")}</h2>
        <Link
          href="/subscriptions?status=expiring_soon&sort=expiry"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t("overview.tables.viewAll")}
        </Link>
      </div>

      {loadError ? (
        <p className="text-sm text-red-600">{t("common.loadError")}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("overview.tables.expiring.empty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("overview.tables.expiring.name")}</th>
                <th className="p-3 font-medium">{t("overview.tables.expiring.plan")}</th>
                <th className="p-3 font-medium">{t("overview.tables.expiring.expiryDate")}</th>
                <th className="p-3 font-medium">{t("overview.tables.expiring.status")}</th>
                <th className="p-3 font-medium">{t("overview.tables.expiring.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = EXPIRING_STATUS_BADGE_CONFIG[row.status];
                const Icon = badge.icon;
                return (
                  <tr key={row.subscriptionId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {row.memberName.slice(0, 1).toUpperCase()}
                        </div>
                        {row.memberName}
                      </div>
                    </td>
                    <td className="p-3">{row.planName}</td>
                    <td className="p-3">{row.expiryDate ? formatLocalDate(row.expiryDate, i18n.language) : "—"}</td>
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
                        className="border-green-200 text-green-700 hover:bg-green-50 hover:text-green-800"
                        onClick={() => setRenewingRow(row)}
                      >
                        <RotateCw size={14} />
                        {t("subscriptions.actions.renew")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {renewingRow && (
        <RenewalModal
          memberId={renewingRow.memberId}
          memberName={renewingRow.memberName}
          originalExpiryDate={
            (renewingRow.status === "grace_period" || renewingRow.status === "expired") && renewingRow.expiryDate
              ? renewingRow.expiryDate
              : undefined
          }
          mobileMoneyEnabled={mobileMoneyEnabled}
          onClose={() => setRenewingRow(null)}
          onRenewed={handleRenewed}
        />
      )}
    </section>
  );
}
